/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { inspect } from 'node:util';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { DatabaseRunRepository, STORE_ENTITIES, STORE_MIGRATIONS } from '@chamvi/store-db';
import { ControllableClock } from '@chamvi/test-kit';
import { DataSource, QueryFailedError } from 'typeorm';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    DEFAULT_PURGE_INTERVAL_MS,
    configModule,
    runHooks,
    storeModule,
} from '@chamvi/app';
import type { AppMode, StoreModuleOptions } from '@chamvi/app';
import { createStoppedError } from '../../../../src/module/helpers.ts';
import { STORE_CONNECT_TIMEOUT_MS } from '../../../../src/modules/repository/constants.ts';
import { StoreModule } from '../../../../src/modules/repository/module.ts';
import { buildHarness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import { createTestDatabaseUrl, describePostgres } from '../../../utils/database.ts';


function build(options: {
    mode?: AppMode;
    check?: boolean;
    env?: Record<string, string>;
    store?: StoreModuleOptions;
}) {
    const clock = new ControllableClock();
    const logger = createRecordingLogger(clock);
    const harness = buildHarness({
        mode: options.mode ?? 'start',
        ...(options.check && { check: true }),
        env: { ...options.env },
        modules: [configModule({ clock, logger }), storeModule(options.store)],
    });

    return {
        harness,
        clock,
        logger,
    };
}

let admin: DataSource | undefined;

async function openAdmin(url: string): Promise<DataSource> {
    admin = new DataSource({ type: 'postgres', url });
    await admin.initialize();

    return admin;
}

async function closeAdmin(): Promise<void> {
    if (admin?.isInitialized) {
        await admin.destroy();
    }

    admin = undefined;
}

/** A fresh database owned by a new role whose password is `password`, as a URL of that role. */
async function createUrlWithPassword(password: string): Promise<string> {
    const url = new URL(await createTestDatabaseUrl());
    const role = `chamvi_role_${randomUUID().replaceAll('-', '')}`;
    const database = url.pathname.slice(1);
    const seed = new DataSource({ type: 'postgres', url: url.href });

    await seed.initialize();

    try {
        await seed.query(`CREATE ROLE "${role}" LOGIN PASSWORD '${password}'`);
        await seed.query(`ALTER DATABASE "${database}" OWNER TO "${role}"`);
    } finally {
        await seed.destroy();
    }

    url.username = role;
    url.password = password;

    return url.href;
}

async function tableExists(dataSource: DataSource, table: string): Promise<boolean> {
    const rows: Array<{ exists: string | null }> = await dataSource.query('SELECT to_regclass($1) AS exists', [table]);

    return rows[0]?.exists !== null;
}

describe('storeModule on a database URL', () => {
    it('an unreachable DATABASE_URL fails setup and never shows the password', async () => {
        const { harness, logger } = build({ env: { DATABASE_URL: 'postgres://u:sekr3t@127.0.0.1:1/x' } });

        const error = await harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(inspect(error, { depth: 5 })).not.toContain('sekr3t');
        expect(logger.lines.join('\n')).not.toContain('sekr3t');
        expect(inspect(harness.reported, { depth: 5 })).not.toContain('sekr3t');
        expect(harness.container.has(AppToken.STORE)).toBe(false);
    });

    it('an unreachable DATABASE_URL fails a check too', async () => {
        const { harness } = build({ check: true, env: { DATABASE_URL: 'postgres://u:sekr3t@127.0.0.1:1/x' } });

        const error = await harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(InvalidAgentDefinitionError);
        expect(inspect(error, { depth: 5 })).not.toContain('sekr3t');
    });

    it('a server that never answers fails setup after the connect timeout', async () => {
        // accepts the TCP connection and never speaks the Postgres protocol (a dropped-packet network)
        const sockets: Socket[] = [];
        const server = createServer((socket) => {
            sockets.push(socket);
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });

        const { port } = server.address() as AddressInfo;

        class QuickStoreModule extends StoreModule {
            protected override connectTimeoutMs = 200;
        }
        const harness = buildHarness({
            env: { DATABASE_URL: `postgres://u:p@127.0.0.1:${port}/x` },
            modules: [configModule({ logger: createRecordingLogger() }), new QuickStoreModule()],
        });

        try {
            const began = Date.now();

            await expect(harness.setup()).rejects.toBeInstanceOf(Error);
            expect(Date.now() - began).toBeLessThan(5_000);
            expect(harness.container.has(AppToken.STORE)).toBe(false);
        } finally {
            sockets.forEach((socket) => socket.destroy());
            await new Promise((resolve) => {
                server.close(resolve);
            });
        }
    });

    it('the default connect timeout ends well inside the force exit', () => {
        expect(STORE_CONNECT_TIMEOUT_MS).toBeGreaterThan(0);
        expect(STORE_CONNECT_TIMEOUT_MS).toBeLessThan(90_000);
    });

    it('an uninitialized dataSource is a definition error', async () => {
        const dataSource = new DataSource({ type: 'postgres', url: 'postgres://u:p@127.0.0.1:1/x' });
        const { harness } = build({ store: { dataSource } });

        await expect(harness.setup()).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        expect(harness.container.has(AppToken.STORE)).toBe(false);
    });

    it('stop during migrate: an aborted context initializes nothing', async () => {
        const { harness } = build({ mode: 'migrate', env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' } });

        harness.controller.abort(createStoppedError());

        await expect(harness.setup()).rejects.toMatchObject({ code: APP_ERROR_CODE.STOPPED });
        expect(harness.container.has(AppToken.DATA_SOURCE)).toBe(false);
        expect(harness.container.has(AppToken.STORE)).toBe(false);
    });
});

describePostgres('storeModule on Postgres', () => {
    it('migrate mode migrates and closes', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ mode: 'migrate', env: { DATABASE_URL: url } });

        await harness.setup();

        const dataSource = harness.container.resolve(AppToken.DATA_SOURCE);

        expect(await tableExists(dataSource, 'chamvi_runs')).toBe(true);
        expect(harness.container.resolve(AppToken.STORE).runs).toBeInstanceOf(DatabaseRunRepository);

        await harness.stop();
        expect(dataSource.isInitialized).toBe(false);
    });

    it('start mode migrates', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ env: { DATABASE_URL: url } });

        await harness.setup();

        const store = harness.container.resolve(AppToken.STORE);

        await expect(store.runs.find({})).resolves.toMatchObject({ total: 0 });
        await harness.stop();
    });

    it('start mode skips the migration with CHAMVI_MIGRATE=false', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ env: { DATABASE_URL: url, CHAMVI_MIGRATE: 'false' } });

        await harness.setup();

        const store = harness.container.resolve(AppToken.STORE);

        expect(store.runs).toBeInstanceOf(DatabaseRunRepository);
        await expect(store.runs.find({})).rejects.toThrow();
        await harness.stop();
    });

    it('options.url wins over DATABASE_URL', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' }, store: { url } });

        await harness.setup();

        expect(harness.container.resolve(AppToken.STORE).runs).toBeInstanceOf(DatabaseRunRepository);
        await harness.stop();
    });

    it('a failed migration leaves no open connection', async () => {
        const url = await createTestDatabaseUrl();
        const seed = new DataSource({ type: 'postgres', url });

        await seed.initialize();
        await seed.query('CREATE TABLE "chamvi_checkpoints" ("id" int)');
        await seed.destroy();

        const { harness } = build({ env: { DATABASE_URL: url } });
        const error = await harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(QueryFailedError);
        expect(error).toMatchObject({ driverError: { code: '42P07' } });
        expect((error as Error).message).toMatch(/chamvi_checkpoints/);
        expect(harness.container.resolve(AppToken.DATA_SOURCE).isInitialized).toBe(false);
        expect(harness.container.has(AppToken.STORE)).toBe(false);
    });

    it('a failed migration keeps the TypeORM error for a password found in the stack', async () => {
        const url = await createUrlWithPassword('postgres');
        const seed = new DataSource({ type: 'postgres', url });

        await seed.initialize();
        await seed.query('CREATE TABLE "chamvi_checkpoints" ("id" int)');
        await seed.destroy();

        const { harness } = build({ env: { DATABASE_URL: url } });
        const error = await harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(QueryFailedError);
        expect(error).toMatchObject({ driverError: { code: '42P07' } });
        expect((error as Error).message).toBe('relation "chamvi_checkpoints" already exists');
    });

    it('a stop after initialize rejects app_stopped, also for a password like "app"', async () => {
        const url = await createUrlWithPassword('app');
        const { harness } = build({ mode: 'migrate', env: { DATABASE_URL: url } });
        const { initialize } = DataSource.prototype;
        const spy = vi.spyOn(DataSource.prototype, 'initialize').mockImplementation(async function (this: DataSource) {
            const result = await initialize.call(this);

            harness.controller.abort(createStoppedError());

            return result;
        });

        try {
            const error = await harness.setup().then(() => undefined, (e: unknown) => e);

            expect(error).toMatchObject({ code: APP_ERROR_CODE.STOPPED, message: 'The app was stopped.' });

            const dataSource = harness.container.resolve(AppToken.DATA_SOURCE);

            expect(dataSource.isInitialized).toBe(false);
            expect(await tableExists(await openAdmin(url), 'chamvi_runs')).toBe(false);
        } finally {
            spy.mockRestore();
            await closeAdmin();
        }
    });

    it('a given dataSource is used and not destroyed', async () => {
        const url = await createTestDatabaseUrl();
        const dataSource = new DataSource({
            type: 'postgres',
            url,
            entities: STORE_ENTITIES,
            migrations: STORE_MIGRATIONS,
        });

        await dataSource.initialize();

        try {
            const { harness } = build({ env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' }, store: { dataSource } });

            await harness.setup();

            expect(harness.container.resolve(AppToken.DATA_SOURCE)).toBe(dataSource);

            const store = harness.container.resolve(AppToken.STORE);

            expect(store.runs).toBeInstanceOf(DatabaseRunRepository);
            await expect(store.runs.find({})).resolves.toMatchObject({ total: 0 });

            await harness.stop();
            expect(dataSource.isInitialized).toBe(true);
        } finally {
            await dataSource.destroy();
        }
    });

    it('purge on Postgres', async () => {
        const url = await createTestDatabaseUrl();
        const {
            harness,
            clock,
            logger,
        } = build({ env: { DATABASE_URL: url } });

        await harness.setup();

        const store = harness.container.resolve(AppToken.STORE);

        await store.locks.acquire('lock', 'owner', 1000);
        await runHooks(harness.container, 'started');
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);

        await vi.waitFor(() => {
            expect(logger.entries.find((entry) => entry.level === 'debug')).toMatchObject({ results: [0, 1] });
        });

        await runHooks(harness.container, 'stopping');
        await harness.stop();
    });

    it('check mode on an unmigrated database fails with store_not_migrated and creates nothing', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ check: true, env: { DATABASE_URL: url, CHAMVI_MIGRATE: 'false' } });

        const error = await harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toMatchObject({ code: APP_ERROR_CODE.STORE_NOT_MIGRATED });
        expect((error as Error).message).toBe(
            `The store has ${STORE_MIGRATIONS.length} pending migration(s); run chamvi migrate or set CHAMVI_MIGRATE=true.`,
        );

        const ds = await openAdmin(url);

        try {
            expect(await tableExists(ds, 'migrations')).toBe(false);
            expect(await tableExists(ds, 'chamvi_runs')).toBe(false);
        } finally {
            await closeAdmin();
        }
    });

    it('check mode with CHAMVI_MIGRATE=true passes and migrates nothing', async () => {
        const url = await createTestDatabaseUrl();
        const { harness } = build({ check: true, env: { DATABASE_URL: url, CHAMVI_MIGRATE: 'true' } });

        await harness.setup();
        await harness.stop();

        const ds = await openAdmin(url);

        try {
            expect(await tableExists(ds, 'migrations')).toBe(false);
            expect(await tableExists(ds, 'chamvi_runs')).toBe(false);
        } finally {
            await closeAdmin();
        }
    });

    it('check mode on a migrated database passes', async () => {
        const url = await createTestDatabaseUrl();
        const first = build({ env: { DATABASE_URL: url } });

        await first.harness.setup();
        await first.harness.stop();

        const { harness } = build({ check: true, env: { DATABASE_URL: url, CHAMVI_MIGRATE: 'false' } });

        await harness.setup();
        expect(harness.container.resolve(AppToken.STORE).runs).toBeInstanceOf(DatabaseRunRepository);
        await harness.stop();
    });
});

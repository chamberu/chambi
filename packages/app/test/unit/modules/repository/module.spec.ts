/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryRunRepository, createMemoryRepositories } from '@chamvi/core';
import type { Repositories } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { describe, expect, it } from 'vitest';
import {
    AppToken,
    DEFAULT_PURGE_INTERVAL_MS,
    ModuleName,
    configModule,
    repositoryModule,
    runHooks,
} from '@chamvi/app';
import type { AppMode } from '@chamvi/app';
import { createHarness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';


function flush(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
}

/** A memory repositories with a purgeExpired whose calls settle on demand. */
function purgingRepository() {
    const calls: Array<{ resolve(value: unknown): void; reject(error: unknown): void }> = [];
    const store = createMemoryRepositories();
    Object.assign(store.idempotency, {
        purgeExpired: () => new Promise<unknown>((resolve, reject) => {
            calls.push({ resolve, reject });
        }),
    });
    return { repositories: store, calls };
}

async function setup(options: {
    mode?: AppMode;
    dev?: boolean;
    env?: Record<string, string>;
    repositories?: Repositories;
} = {}) {
    const clock = new ControllableClock();
    const logger = createRecordingLogger(clock);
    const harness = await createHarness({
        mode: options.mode,
        dev: options.dev,
        env: { ...options.env },
        modules: [
            configModule({ clock, logger }),
            repositoryModule(options.repositories ? { repositories: options.repositories } : {}),
        ],
    });
    return {
        harness,
        clock,
        logger,
    };
}

describe('repositoryModule', () => {
    it('is named and depends on the config module', () => {
        const module = repositoryModule();
        expect(module.name).toBe(ModuleName.STORE);
        expect(module.dependencies).toEqual([ModuleName.CONFIG]);
    });

    it('memory repositories without DATABASE_URL', async () => {
        const { harness, clock } = await setup();
        const store = harness.container.resolve(AppToken.REPOSITORIES);
        expect(store.runs).toBeInstanceOf(MemoryRunRepository);

        // the store runs on the app clock
        await store.locks.acquire('l', 'a', 1000);
        clock.advance(1000);
        await expect(store.locks.acquire('l', 'b', 1000)).resolves.toBe(true);
        await harness.stop();
    });

    it('warns outside dev', async () => {
        const { harness, logger } = await setup();
        const warnings = logger.entries.filter((entry) => entry.msg.includes('DATABASE_URL'));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]!.level).toBe('warn');
        expect(warnings[0]!.msg).toContain('memory repositories');
        await harness.stop();
    });

    it('silent in dev', async () => {
        const { harness, logger } = await setup({ dev: true });
        expect(logger.entries.filter((entry) => entry.msg.includes('DATABASE_URL'))).toEqual([]);
        await harness.stop();
    });

    it('accepts a repositories bundle without conversation persistence', async () => {
        const repositories = { ...createMemoryRepositories(), conversations: undefined };
        const { harness } = await setup({ repositories });
        expect(harness.container.resolve(AppToken.REPOSITORIES)).toBe(repositories);
        await harness.stop();
    });

    it('uses a given store', async () => {
        const store = createMemoryRepositories();
        const { harness, logger } = await setup({ repositories: store });
        expect(harness.container.resolve(AppToken.REPOSITORIES)).toBe(store);
        expect(logger.entries).toEqual([]);
        await harness.stop();
    });

    it('purge runs every interval and never overlaps', async () => {
        const { repositories: store, calls } = purgingRepository();
        const {
            harness,
            clock,
            logger,
        } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');

        clock.advance(DEFAULT_PURGE_INTERVAL_MS - 1);
        expect(calls).toHaveLength(0);
        clock.advance(1);
        expect(calls).toHaveLength(1);

        // pending: no second call however long it takes
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        expect(calls).toHaveLength(1);

        calls[0]!.resolve({ idempotencyKeys: 2, locks: 1 });
        await flush();
        expect(logger.entries.find((entry) => entry.level === 'debug')).toMatchObject({ results: [{ idempotencyKeys: 2, locks: 1 }] });

        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        expect(calls).toHaveLength(2);
        calls[1]!.resolve({ idempotencyKeys: 0, locks: 0 });
        await runHooks(harness.container, 'stopping');
        await harness.stop();
    });

    it('purge stops on stopping', async () => {
        const { repositories: store, calls } = purgingRepository();
        const { harness, clock } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');
        await runHooks(harness.container, 'stopping');

        clock.advance(DEFAULT_PURGE_INTERVAL_MS * 3);
        expect(calls).toHaveLength(0);
        await harness.stop();
    });

    it('stopping prevents the re-arm of a call in flight', async () => {
        const { repositories: store, calls } = purgingRepository();
        const { harness, clock } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        expect(calls).toHaveLength(1);

        const stopping = Promise.all([
            runHooks(harness.container, 'stopping'),
            runHooks(harness.container, 'stopping'),
        ]);
        calls[0]!.resolve({ idempotencyKeys: 0, locks: 0 });
        await stopping;
        clock.advance(DEFAULT_PURGE_INTERVAL_MS * 3);
        expect(calls).toHaveLength(1);
        await harness.stop();
    });

    it('stopping waits for a call in flight', async () => {
        const { repositories: store, calls } = purgingRepository();
        const { harness, clock } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        expect(calls).toHaveLength(1);

        let stopped = false;
        const stopping = runHooks(harness.container, 'stopping').then(() => {
            stopped = true;
        });
        await flush();
        expect(stopped).toBe(false);

        calls[0]!.resolve({});
        await stopping;
        expect(stopped).toBe(true);
        await harness.stop();
    });

    it('purge failure is logged and re-armed', async () => {
        const { repositories: store, calls } = purgingRepository();
        const {
            harness,
            clock,
            logger,
        } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');
        clock.advance(DEFAULT_PURGE_INTERVAL_MS);

        calls[0]!.reject(new Error('connection lost'));
        await flush();
        const errors = logger.entries.filter((entry) => entry.level === 'error');
        expect(errors).toHaveLength(1);
        expect(errors[0]!.error).toMatchObject({ message: 'connection lost' });

        clock.advance(DEFAULT_PURGE_INTERVAL_MS);
        expect(calls).toHaveLength(2);
        calls[1]!.resolve({});
        await runHooks(harness.container, 'stopping');
        await harness.stop();
    });

    it('teardown stops the purge timer', async () => {
        const { repositories: store, calls } = purgingRepository();
        const { harness, clock } = await setup({ repositories: store });
        await runHooks(harness.container, 'started');
        await harness.stop();

        clock.advance(DEFAULT_PURGE_INTERVAL_MS * 3);
        expect(calls).toHaveLength(0);
    });

    it.each(['job', 'migrate'] as const)('no purge hook in %s mode', async (mode) => {
        const { repositories: store } = purgingRepository();
        const { harness } = await setup({
            mode,
            repositories: store,
            env: mode === 'migrate' ? { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/x' } : {},
        });
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
        await harness.stop();
    });

    it('no purge hook when CHAMVI_PURGE_INTERVAL_MS=0', async () => {
        const { repositories: store } = purgingRepository();
        const { harness } = await setup({ repositories: store, env: { CHAMVI_PURGE_INTERVAL_MS: '0' } });
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
        await harness.stop();
    });

    it('no purge hook for a store without purgeExpired', async () => {
        const { harness } = await setup();
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
        await harness.stop();
    });

    it('registers the purge hook', async () => {
        const { repositories: store } = purgingRepository();
        const { harness } = await setup({ repositories: store });
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS).map((hook) => hook.name)).toEqual(['chamvi:purge']);
        await harness.stop();
    });
});

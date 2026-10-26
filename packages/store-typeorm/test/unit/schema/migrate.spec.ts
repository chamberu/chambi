/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { assertSchemaMatchesMetadata } from 'typeorm-extension';
import {
    afterEach,
    expect,
    it,
} from 'vitest';
import { migrateStore, pendingMigrations } from '@chamvi/store-typeorm';
import { TableName } from '../../../src/entities/constants.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';
import type { TestDataSourceOptions } from '../../utils/database.ts';

describePostgres('schema', () => {
    const dataSources: DataSource[] = [];

    const create = async (opts?: TestDataSourceOptions) => {
        const dataSource = await createTestDataSource(opts);
        dataSources.push(dataSource);
        return dataSource;
    };

    afterEach(async () => {
        await Promise.all(dataSources.map((ds) => ds.destroy()));
        dataSources.length = 0;
    });

    it('the migration creates the schema the entities describe', async () => {
        const ds = await create();
        await expect(assertSchemaMatchesMetadata(ds)).resolves.toBeUndefined();
    });

    it('creates the GIN index on docs', async () => {
        const ds = await create();
        const rows: { indexdef: string }[] = await ds.query(
            'SELECT indexdef FROM pg_indexes WHERE indexname = $1',
            ['IDX_chamvi_docs_doc_gin'],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]!.indexdef).toContain('USING gin');
    });

    it('indexes artifacts by run', async () => {
        const ds = await create();
        const rows: { indexdef: string }[] = await ds.query(
            'SELECT indexdef FROM pg_indexes WHERE tablename = $1',
            [TableName.ARTIFACTS],
        );
        expect(rows.some((row) => row.indexdef.includes('(run_id)'))).toBe(true);
    });

    it('migrateStore is safe to call concurrently and twice', async () => {
        const ds = await create({ migrate: false });
        await Promise.all([migrateStore(ds), migrateStore(ds)]);
        await migrateStore(ds);

        const migrations: { name: string }[] = await ds.query('SELECT name FROM migrations ORDER BY id');
        expect(migrations.map((m) => m.name)).toEqual(['Init1792195200000', 'Artifacts1792368000000', 'IdempotencyScope1792454400000', 'KvKeyCollation1792540800000', 'AgentRevisions1792627200000']);

        const tables: { table_name: string }[] = await ds.query(
            'SELECT table_name FROM information_schema.tables WHERE table_name = ANY($1::text[])',
            [Object.values(TableName)],
        );
        expect(tables.map((t) => t.table_name).sort()).toEqual(Object.values(TableName).sort());
    });

    it('pendingMigrations lists every migration on an empty database and none after migrateStore', async () => {
        const ds = await create({ migrate: false });
        expect(await pendingMigrations(ds)).toEqual([
            'Init1792195200000',
            'Artifacts1792368000000',
            'IdempotencyScope1792454400000',
            'KvKeyCollation1792540800000',
            'AgentRevisions1792627200000',
        ]);
        await migrateStore(ds);
        expect(await pendingMigrations(ds)).toEqual([]);
    });

    it('pendingMigrations does not create the migrations table', async () => {
        const ds = await create({ migrate: false });
        await pendingMigrations(ds);
        const queryRunner = ds.createQueryRunner();
        try {
            expect(await queryRunner.hasTable('migrations')).toBe(false);
        } finally {
            await queryRunner.release();
        }
    });

    it('the migration reverts in a schema other than public', async () => {
        const ds = await create({ schema: 'other' });
        const tablesIn = async (schema: string) => {
            const rows: { table_name: string }[] = await ds.query(
                'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = ANY($2::text[])',
                [schema, Object.values(TableName)],
            );
            return rows.length;
        };
        expect(await tablesIn('other')).toBe(Object.values(TableName).length);
        expect(await tablesIn('public')).toBe(0);

        const scopeLength = async () => {
            const [row]: { length: number }[] = await ds.query(
                'SELECT character_maximum_length AS length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
                ['other', TableName.IDEMPOTENCY_KEYS, 'scope'],
            );
            return row?.length;
        };
        const keyCollation = async () => {
            const [row]: { collation: string | null }[] = await ds.query(
                'SELECT collation_name AS collation FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
                ['other', TableName.KV, 'key'],
            );
            return row?.collation;
        };
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await tablesIn('other')).toBe(Object.values(TableName).length - 1);

        expect(await keyCollation()).toBe('C');
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await keyCollation()).toBeNull();

        expect(await scopeLength()).toBe(1024);
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await scopeLength()).toBe(255);
        expect(await tablesIn('other')).toBe(Object.values(TableName).length - 1);

        await ds.undoLastMigration({ transaction: 'each' });
        expect(await tablesIn('other')).toBe(Object.values(TableName).length - 2);
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await tablesIn('other')).toBe(0);
    });

    it('migrateStore needs one connection per call (it migrates on the connection holding the lock)', async () => {
        const within = <T>(promise: Promise<T>) => Promise.race([
            promise,
            new Promise<never>((_resolve, reject) => {
                setTimeout(() => reject(new Error('migrateStore did not finish within 5 s')), 5_000);
            }),
        ]);

        const single = await create({ migrate: false, max: 1 });
        await expect(within(migrateStore(single))).resolves.toBeUndefined();

        const pair = await create({ migrate: false, max: 2 });
        await expect(within(Promise.all([migrateStore(pair), migrateStore(pair)]))).resolves.toHaveLength(2);
        await expect(assertSchemaMatchesMetadata(pair)).resolves.toBeUndefined();
    }, 15_000);
});

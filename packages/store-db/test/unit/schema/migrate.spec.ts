/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DataSource } from 'typeorm';
import { assertSchemaMatchesMetadata } from 'typeorm-extension';
import {
    afterEach,
    expect,
    it,
} from 'vitest';
import {
    DatabaseRunRepository,
    STORE_MIGRATIONS,
    migrateStore,
    pendingMigrations,
} from '@chamvi/store-db';
import { TableName } from '../../../src/entities/constants.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';
import type { TestDataSourceOptions } from '../../utils/database.ts';
import { seedRun } from '../../utils/conversation.ts';

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

    it('taints legacy nonterminal runs at migration time while leaving terminal and new runs clean', async () => {
        const ds = await create({ migrate: false });
        const prior = new DataSource({
            ...ds.options,
            migrations: STORE_MIGRATIONS.filter((migration) => migration.name !== 'RunTaint1792800000000'),
        });

        await prior.initialize();

        try {
            await migrateStore(prior);

            for (const status of ['queued', 'running', 'waiting', 'interrupted', 'completed', 'failed', 'cancelled']) {
                await prior.query(
                    'INSERT INTO chamvi_runs (id, agent, status, trigger, usage, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $6)',
                    [status, 'helper', status, JSON.stringify({
                        id: status,
                        agent: 'helper',
                        trigger: 'message',
                        channel: 'chat',
                        payload: {},
                        receivedAt: '2026-10-28T00:00:00.000Z',
                    }), JSON.stringify({ inputTokens: 0, outputTokens: 0 }), new Date('2026-10-28T00:00:00.000Z')],
                );
            }
        } finally {
            await prior.destroy();
        }

        await expect(pendingMigrations(ds)).resolves.toEqual(['RunTaint1792800000000']);

        const [beforeMigration]: { at: Date }[] = await ds.query('SELECT clock_timestamp() AS at');

        await migrateStore(ds);

        const [afterMigration]: { at: Date }[] = await ds.query('SELECT clock_timestamp() AS at');
        const runs = new DatabaseRunRepository({ dataSource: ds });

        for (const status of ['queued', 'running', 'waiting', 'interrupted']) {
            const existing = await runs.findOneOrFail(status);

            expect(existing.status).toBe(status);
            expect(existing.taint?.source).toBe('migration:legacy-run');
            expect(existing.taint?.at).toBeInstanceOf(Date);
            expect(existing.taint!.at.getTime()).toBeGreaterThanOrEqual(beforeMigration!.at.getTime());
            expect(existing.taint!.at.getTime()).toBeLessThanOrEqual(afterMigration!.at.getTime());
        }

        await seedRun(ds, 'new-clean');

        for (const id of ['completed', 'failed', 'cancelled', 'new-clean']) {
            expect((await runs.findOneOrFail(id)).taint).toBeUndefined();
        }
    });

    it('upgrades legacy orphan checkpoints and steps without losing data while enforcing new run references', async () => {
        const ds = await create({ migrate: false });
        const prior = new DataSource({
            ...ds.options,
            migrations: STORE_MIGRATIONS.slice(0, STORE_MIGRATIONS.findIndex((migration) => migration.name === 'Conversations1792713600000')),
        });

        await prior.initialize();
        dataSources.push(prior);
        await migrateStore(prior);
        expect(await pendingMigrations(ds)).toEqual(['Conversations1792713600000', 'RunTaint1792800000000']);

        const insertCheckpoint = (runId: string) => ds.query(
            'INSERT INTO chamvi_checkpoints (run_id, step_index, messages, finish_reason, created_at) VALUES ($1, 3, $2, $3, $4)',
            [runId, JSON.stringify([{ role: 'user', content: 'legacy checkpoint' }]), 'stop', new Date('2026-10-28T00:00:00.000Z')],
        );
        const insertStep = (runId: string) => ds.query(
            'INSERT INTO chamvi_steps (run_id, step_index, kind, name, input, output, started_at, finished_at) VALUES ($1, 2, $2, $3, $4, $5, $6, $6)',
            [runId, 'tool', 'legacy tool', JSON.stringify({ input: 'kept' }), JSON.stringify({ output: 'kept' }), new Date('2026-10-28T00:00:00.000Z')],
        );

        await insertCheckpoint('legacy-checkpoint-only');
        await insertStep('legacy-step-only');

        const checkpointQuery = 'SELECT run_id, step_index, messages, finish_reason, created_at FROM chamvi_checkpoints';
        const checkpoints = await ds.query(checkpointQuery);
        const steps = await ds.query('SELECT * FROM chamvi_steps');

        await migrateStore(ds);

        expect(await pendingMigrations(ds)).toEqual([]);
        expect(await ds.query(checkpointQuery)).toEqual(checkpoints);
        expect(await ds.query('SELECT * FROM chamvi_steps')).toEqual(steps);
        expect(await ds.query('SELECT * FROM chamvi_runs')).toEqual([]);
        await expect(insertCheckpoint('new-missing-run')).rejects.toMatchObject({ driverError: { code: '23503' } });
        await expect(insertStep('new-missing-run')).rejects.toMatchObject({ driverError: { code: '23503' } });
        await expect(ds.query('UPDATE chamvi_checkpoints SET run_id = $1', ['another-missing-run']))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
        await expect(ds.query('UPDATE chamvi_steps SET run_id = $1', ['another-missing-run']))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
        await expect(assertSchemaMatchesMetadata(ds)).resolves.toBeUndefined();
    });

    it('store fixed conversation fields as columns and only frozen messages as JSONB', async () => {
        const ds = await create();
        const runner = ds.createQueryRunner();

        try {
            const names = [
                TableName.CONVERSATIONS,
                TableName.CONVERSATION_ITEMS,
                TableName.CONVERSATION_NOTES,
                TableName.CONVERSATION_OPERATIONS,
            ];
            const tables = await runner.getTables(names);

            expect(await runner.hasTable('chamvi_conversation_turns')).toBe(false);
            expect(tables.flatMap((table) => table.columns.filter((column) => column.type === 'jsonb')
                .map((column) => `${table.name}.${column.name}`))).toEqual([`${TableName.CONVERSATIONS}.snapshot_messages`]);

            for (const name of [TableName.RUNS, TableName.CHECKPOINTS]) {
                const table = await runner.getTable(name);

                expect(table?.findColumnByName('conversation')).toBeUndefined();
                expect(table?.findColumnByName('conversation_scope_id')?.type).toBe('character varying');
            }

            for (const name of names.slice(1)) {
                const table = tables.find((entry) => entry.name === name)!;

                expect(table.foreignKeys).toHaveLength(2);
                expect(table.foreignKeys.find((key) => key.columnNames.includes('scope_id'))).toMatchObject({
                    columnNames: ['scope_id'],
                    referencedTableName: TableName.CONVERSATIONS,
                    referencedColumnNames: ['id'],
                });
            }
        } finally {
            await runner.release();
        }
    });

    it('rejects orphaned conversation rows while retaining historical generations', async () => {
        const ds = await create();
        const { DatabaseConversationRepository } = await import('@chamvi/store-db');
        const { DEFAULT_CONVERSATION_LIMITS } = await import('@chamvi/core');
        const store = new DatabaseConversationRepository({ dataSource: ds });
        const identity = {
            agent: 'helper',
            channel: 'chat',
            account: 'main',
            chat: 'room',
            audience: 'direct',
        };
        const scope = await store.resolve(identity);

        await seedRun(ds, 'run');
        await store.beginTurn(scope, 'run', 'hello', DEFAULT_CONVERSATION_LIMITS);
        await store.applyNote(scope, {
            kind: 'set',
            id: 'op',
            inputHash: 'hash',
            key: 'topic',
            text: 'hello',
            source: {
                runId: 'run',
                toolCallId: 'call',
                stepIndex: 0,
            },
        });

        const ownedTables = [
            TableName.CONVERSATION_ITEMS,
            TableName.CONVERSATION_NOTES,
            TableName.CONVERSATION_OPERATIONS,
        ];

        for (const table of ownedTables) {
            await expect(ds.query(`UPDATE "${table}" SET scope_id = $1`, ['b'.repeat(64)]))
                .rejects.toMatchObject({ driverError: { code: '23503' } });
        }

        await store.endTurn(scope, 'run', []);
        await store.reset(identity, { keepNotes: true });
        expect((await store.findItems(scope, { limit: 10, offset: 0 })).total).toBe(1);
        await expect(ds.query('DELETE FROM chamvi_conversations WHERE id = $1', [scope.id]))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
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

        expect(migrations.map((m) => m.name)).toEqual(STORE_MIGRATIONS.map((migration) => migration.name));

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
            'Conversations1792713600000',
            'RunTaint1792800000000',
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

        const taintColumns = () => ds.query(
            'SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3',
            ['other', TableName.RUNS, 'taint'],
        );

        expect(await taintColumns()).toHaveLength(1);
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await taintColumns()).toHaveLength(0);
        expect(await tablesIn('other')).toBe(Object.values(TableName).length);

        await ds.undoLastMigration({ transaction: 'each' });

        const tableCount = Object.values(TableName).length - 4;

        expect(await tablesIn('other')).toBe(tableCount);

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
        expect(await tablesIn('other')).toBe(tableCount - 1);

        expect(await keyCollation()).toBe('C');
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await keyCollation()).toBeNull();

        expect(await scopeLength()).toBe(1024);
        await ds.undoLastMigration({ transaction: 'each' });
        expect(await scopeLength()).toBe(255);
        expect(await tablesIn('other')).toBe(tableCount - 1);

        await ds.undoLastMigration({ transaction: 'each' });
        expect(await tablesIn('other')).toBe(tableCount - 2);
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

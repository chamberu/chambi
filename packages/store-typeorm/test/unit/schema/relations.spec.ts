/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS } from '@chamvi/core';
import { TypeormConversationStore, createTypeormStores } from '@chamvi/store-typeorm';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';
import { seedRun } from '../../utils/conversation.ts';
import { TableName } from '../../../src/entities/constants.ts';
import {
    CheckpointEntity,
    ConversationEntity,
    ConversationOperationEntity,
    RunEntity,
} from '../../../src/entities/index.ts';

const IDENTITY = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'relations',
    audience: 'direct',
};
const REFERENCES = [
    ['chamvi_conversations', 'active_run_id', 'chamvi_runs'],
    ['chamvi_conversation_items', 'run_id', 'chamvi_runs'],
    ['chamvi_conversation_notes', 'run_id', 'chamvi_runs'],
    ['chamvi_conversation_operations', 'run_id', 'chamvi_runs'],
    ['chamvi_checkpoints', 'run_id', 'chamvi_runs'],
    ['chamvi_steps', 'run_id', 'chamvi_runs'],
    ['chamvi_runs', 'conversation_scope_id', 'chamvi_conversations'],
    ['chamvi_checkpoints', 'conversation_scope_id', 'chamvi_conversations'],
] as const;

describePostgres('relational integrity', () => {
    let ds: DataSource;
    afterEach(async () => { if (ds?.isInitialized) await ds.destroy(); });

    it('rejects dangling run and scope references and preserves referenced parents', async () => {
        ds = await createTestDataSource();
        const conversations = new TypeormConversationStore({ dataSource: ds });
        const stores = createTypeormStores({ dataSource: ds });
        const scope = await conversations.resolve(IDENTITY);
        await seedRun(ds, 'run', { conversation: { scope, text: 'input' } });
        await conversations.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS);
        await conversations.applyNote(scope, {
            kind: 'set',
            id: 'op',
            inputHash: 'hash',
            key: 'key',
            text: 'note',
            source: {
                runId: 'run',
                toolCallId: 'call',
                stepIndex: 0,
            },
        });
        const now = new Date();
        await stores.checkpoints.saveCheckpoint({
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: now,
            conversation: { scopeId: scope.id, generation: scope.generation },
        });
        await stores.steps.appendStep({
            runId: 'run',
            index: 0,
            kind: 'llm',
            startedAt: now,
            finishedAt: now,
        });
        const runner = ds.createQueryRunner();
        try {
            for (const [table, column, parent] of REFERENCES) {
                const metadata = await runner.getTable(table);
                expect(metadata?.foreignKeys).toEqual(expect.arrayContaining([expect.objectContaining({
                    columnNames: [column],
                    referencedTableName: parent,
                    referencedColumnNames: ['id'],
                    onDelete: 'NO ACTION',
                })]));
                await expect(ds.query(`UPDATE "${table}" SET "${column}" = $1`, ['missing']))
                    .rejects.toMatchObject({ driverError: { code: '23503' } });
            }
            expect((await runner.getTable('chamvi_checkpoints'))?.findColumnByName('conversation_snapshot_run_id')).toBeUndefined();
        } finally {
            await runner.release();
        }
        await expect(ds.query('DELETE FROM chamvi_runs WHERE id = $1', ['run']))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
        await conversations.endTurn(scope, 'run', []);
        await conversations.reset(IDENTITY, { keepNotes: true });
        expect((await stores.checkpoints.latestCheckpoint('run'))?.conversation).toEqual({ scopeId: scope.id, generation: scope.generation });
        await expect(ds.query('DELETE FROM chamvi_conversations WHERE id = $1', [scope.id]))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
    });

    it('loads related runs and conversations through normal TypeORM relations', async () => {
        ds = await createTestDataSource();
        const conversations = new TypeormConversationStore({ dataSource: ds });
        const stores = createTypeormStores({ dataSource: ds });
        const scope = await conversations.resolve(IDENTITY);
        await seedRun(ds, 'run', { conversation: { scope, text: 'input' } });
        await conversations.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS);
        await conversations.applyNote(scope, {
            kind: 'set',
            id: 'op',
            inputHash: 'hash',
            key: 'key',
            text: 'note',
            source: {
                runId: 'run',
                toolCallId: 'call',
                stepIndex: 0,
            },
        });
        await stores.checkpoints.saveCheckpoint({
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: new Date(),
            conversation: { scopeId: scope.id, generation: scope.generation },
        });
        const checkpoint = await ds.getRepository(CheckpointEntity).findOneOrFail({ where: { runId: 'run' }, relations: { run: true, conversation: true } });
        expect(checkpoint.run?.id).toBe('run');
        expect(checkpoint.conversation?.id).toBe(scope.id);
        const operation = await ds.getRepository(ConversationOperationEntity).findOneOrFail({
            where: {
                scopeId: scope.id,
                id: 'op',
                generation: scope.generation,
            },
            relations: { run: true, conversation: true },
        });
        expect(operation.run?.id).toBe('run');
        expect(operation.conversation?.id).toBe(scope.id);
        const run = await ds.getRepository(RunEntity).findOneOrFail({ where: { id: 'run' }, relations: { conversation: true } });
        expect(run.conversation?.id).toBe(scope.id);
        const conversation = await ds.getRepository(ConversationEntity).findOneOrFail({ where: { id: scope.id }, relations: { activeRun: true } });
        expect(conversation.activeRun?.id).toBe('run');
        const now = new Date();
        await stores.steps.appendStep({
            runId: 'run',
            index: 0,
            kind: 'tool',
            startedAt: now,
            finishedAt: now,
        });
        // These IDs reserve runs before createRun; every other local run/scope ID must be queryable.
        const reservations = new Set([`${TableName.ARTIFACTS}.runId`, `${TableName.IDEMPOTENCY_KEYS}.runId`]);
        for (const metadata of ds.entityMetadatas) {
            for (const column of metadata.columns) {
                let parent: string | undefined;
                if (/runId$/i.test(column.propertyName)) parent = TableName.RUNS;
                else if (/scopeId$/i.test(column.propertyName)) parent = TableName.CONVERSATIONS;
                if (!parent || reservations.has(`${metadata.tableName}.${column.propertyName}`)) continue;
                const relation = metadata.relations.find((entry) => entry.joinColumns.includes(column));
                expect(relation, `${metadata.name}.${column.propertyName} needs an owning TypeORM relation`).toBeDefined();
                if (!relation) continue;
                expect(relation.inverseEntityMetadata.tableName).toBe(parent);
                const entity = await ds.getRepository(metadata.target).createQueryBuilder('entity')
                    .leftJoinAndSelect(`entity.${relation.propertyName}`, 'parent').getOne();
                expect(entity?.[relation.propertyName]).toMatchObject({ id: entity?.[column.propertyName] });
            }
        }
    });

    it('refuses an unknown run without inserting input or taking ownership', async () => {
        ds = await createTestDataSource();
        const store = new TypeormConversationStore({ dataSource: ds });
        const scope = await store.resolve(IDENTITY);
        await expect(store.beginTurn(scope, 'missing', 'input', DEFAULT_CONVERSATION_LIMITS))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
        expect(await store.activeRun(scope)).toBeUndefined();
        expect((await store.listItems(scope, { limit: 10, offset: 0 })).total).toBe(0);
    });
});

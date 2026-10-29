/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterEach, expect, it } from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS } from '@chamvi/core';
import { TypeormConversationStore, TypeormStore } from '@chamvi/store-typeorm';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';
import { seedRun } from '../../utils/conversation.ts';

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
        const runs = new TypeormStore({ dataSource: ds });
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
        await runs.saveCheckpoint({
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: now,
            conversation: { scopeId: scope.id, generation: scope.generation },
        });
        await runs.appendStep({
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
        expect((await runs.latestCheckpoint('run'))?.conversation).toEqual({ scopeId: scope.id, generation: scope.generation });
        await expect(ds.query('DELETE FROM chamvi_conversations WHERE id = $1', [scope.id]))
            .rejects.toMatchObject({ driverError: { code: '23503' } });
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

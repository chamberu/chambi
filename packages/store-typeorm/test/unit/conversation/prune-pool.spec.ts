/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { TypeormStore } from '@chamvi/store-typeorm';
import { SeededConversationStore, seedRun } from '../../utils/conversation.ts';
import { ConversationItemEntity, ConversationOperationEntity } from '../../../src/entities/index.ts';
import { asValues } from '../../../src/store/helpers.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

async function withinPoolDeadline<T>(query: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([query, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error('prune callback could not acquire the single pool connection')), 500);
        })]);
    } finally {
        clearTimeout(timer);
    }
}

describePostgres('conversation pruning on a shared single-connection pool', () => {
    let dataSource: DataSource;
    afterEach(async () => {
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function setup() {
        dataSource = await createTestDataSource({ max: 1 });
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00.000Z'));
        const store = new SeededConversationStore({ dataSource, clock });
        const runs = new TypeormStore({ dataSource, clock });
        const scope = await store.resolve({
            agent: 'helper',
            channel: 'chat',
            account: 'main',
            chat: 'pool',
            audience: 'direct',
        });
        const limits = { ...DEFAULT_CONVERSATION_LIMITS, retentionMs: 10_000 };
        async function seed(runId: string, status?: 'completed' | 'waiting') {
            if (status) {
                await runs.createRun({
                    id: runId,
                    agent: 'helper',
                    status,
                    trigger: {
                        id: runId,
                        agent: 'helper',
                        trigger: 'message',
                        channel: 'chat',
                        payload: 'input',
                        receivedAt: clock.now(),
                    },
                    usage: { inputTokens: 0, outputTokens: 0 },
                    createdAt: clock.now(),
                    updatedAt: clock.now(),
                });
            }
            await store.beginTurn(scope, runId, 'input', limits);
            await store.applyNote(scope, {
                id: runId,
                inputHash: runId,
                kind: 'remove',
                key: 'absent',
                source: {
                    runId,
                    toolCallId: runId,
                    stepIndex: 0,
                },
            });
            await store.endTurn(scope, runId, []);
        }
        return {
            clock,
            store,
            runs,
            scope,
            limits,
            seed,
            operations: dataSource.getRepository(ConversationOperationEntity),
        };
    }

    it('classifies runs through the same pool without holding a transaction connection', async () => {
        const s = await setup();
        await s.seed('completed', 'completed');
        await s.seed('recoverable', 'waiting');
        s.clock.advance(10_000);
        await s.store.prune(s.limits, {
            isSettled: async (runId) => {
                const run = await withinPoolDeadline(s.runs.getRun(runId));
                return !run || ['completed', 'failed', 'cancelled'].includes(run.status);
            },
        });
        expect(await s.operations.find({ select: { runId: true } })).toEqual([{ runId: 'recoverable' }]);
    });

    it('trims a bulk backlog with selects bounded to 100 items', async () => {
        const s = await setup();
        await s.seed('writer', 'completed');
        const items = Array.from({ length: 250 }, (_value, index) => ({
            scopeId: s.scope.id,
            generation: s.scope.generation,
            id: `item-${index}`,
            runId: 'writer',
            createdAt: s.clock.now(),
            role: 'user' as const,
            text: 'input',
            status: 'sent' as const,
        }));
        await dataSource.getRepository(ConversationItemEntity).insert(items.map((item) => asValues<ConversationItemEntity>(item)));
        const queries = vi.spyOn(dataSource.logger, 'logQuery');
        try {
            await s.store.prune({ ...s.limits, maxStoredItems: 10 });
            expect((await s.store.listItems(s.scope, { limit: 10, offset: 0 })).data.map((item) => item.id))
                .toEqual(Array.from({ length: 10 }, (_value, index) => `item-${240 + index}`));
            const limits = queries.mock.calls.map(([query]) => query)
                .filter((query) => query.startsWith('SELECT') && query.includes('chamvi_conversation_items'))
                .flatMap((query) => Array.from(query.matchAll(/LIMIT (\d+)/g), (match) => Number(match[1])));
            expect(limits.length).toBeGreaterThan(0);
            expect(limits.every((limit) => limit <= 100)).toBe(true);
        } finally {
            queries.mockRestore();
        }
    });

    it.each(['active owner', 'changed candidate', 'young candidate'] as const)('rechecks %s after classification and before deletion', async (change) => {
        const s = await setup();
        await s.seed('completed', 'completed');
        s.clock.advance(10_000);
        await s.store.prune(s.limits, {
            isSettled: async (runId) => {
                expect((await withinPoolDeadline(s.runs.getRun(runId)))?.status).toBe('completed');
                if (change === 'active owner') {
                    await withinPoolDeadline(s.store.beginTurn(s.scope, runId, 'resumed input', s.limits));
                } else if (change === 'changed candidate') {
                    await seedRun(dataSource, 'recoverable');
                    await withinPoolDeadline(s.operations.update({ scopeId: s.scope.id, id: runId }, { runId: 'recoverable', inputHash: 'replacement' }));
                } else {
                    await withinPoolDeadline(s.operations.update({ scopeId: s.scope.id, id: runId }, { createdAt: s.clock.now() }));
                }
                return true;
            },
        });
        expect(await s.operations.countBy({ scopeId: s.scope.id })).toBe(1);
    });
});

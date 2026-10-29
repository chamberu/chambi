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
import { TypeormConversationStore } from '@chamvi/store-typeorm';
import { ConversationItemEntity } from '../../../src/entities/index.ts';
import { asValues } from '../../../src/store/helpers.ts';
import { seedRun } from '../../utils/conversation.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

describePostgres('conversation query bounds', () => {
    let dataSource: DataSource;
    afterEach(async () => {
        vi.restoreAllMocks();
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    async function setup() {
        dataSource = await createTestDataSource();
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00.000Z'));
        const store = new TypeormConversationStore({ dataSource, clock });
        const scope = await store.resolve({
            agent: 'helper',
            channel: 'chat',
            account: 'main',
            chat: 'queries',
            audience: 'direct',
        });
        await seedRun(dataSource, 'writer');
        await store.beginTurn(scope, 'writer', 'input', DEFAULT_CONVERSATION_LIMITS);
        return {
            clock,
            store,
            scope,
        };
    }

    it('recalls older fitting records beyond a page without loading the whole transcript', async () => {
        const {
            clock,
            store,
            scope,
        } = await setup();
        await store.endTurn(scope, 'writer', []);
        await seedRun(dataSource, 'next');
        const rows = Array.from({ length: 250 }, (_value, index) => ({
            scopeId: scope.id,
            generation: scope.generation,
            id: `item-${index}`,
            runId: 'writer',
            createdAt: clock.now(),
            role: 'assistant' as const,
            text: index === 0 ? 'é' : 'éé',
            status: 'sent' as const,
        }));
        await dataSource.getRepository(ConversationItemEntity).insert(rows.map((row) => asValues<ConversationItemEntity>(row)));
        await dataSource.getRepository(ConversationItemEntity).insert(asValues<ConversationItemEntity>({
            ...rows[0]!,
            id: 'unknown',
            text: 'u',
            status: 'unknown',
        }));
        const queries = vi.spyOn(dataSource.logger, 'logQuery');
        const result = await store.beginTurn(scope, 'next', 'now', {
            ...DEFAULT_CONVERSATION_LIMITS,
            maxItems: 3,
            maxHistoryBytes: 6,
        });
        expect(result.kind).toBe('ready');
        if (result.kind !== 'ready') throw new Error('expected ready');
        expect(result.snapshot.itemIds).toEqual(['item-0', 'item-249']);
        expect(result.snapshot.messages).toEqual([
            { role: 'assistant', content: 'é' },
            { role: 'assistant', content: 'éé' },
        ]);
        expect(result.snapshot.omitted).toBe(249);
        const textReads = queries.mock.calls.map(([query]) => query)
            .filter((query) => query.startsWith('SELECT') && query.includes('chamvi_conversation_items') && query.includes('"text"'));
        expect(textReads.length).toBeGreaterThan(0);
        for (const query of textReads) {
            const limit = /LIMIT (\d+)/.exec(query);
            expect(limit, query).not.toBeNull();
            expect(Number(limit![1])).toBeLessThanOrEqual(100);
        }
    });

    it.each(['age', 'count'] as const)('trims by %s without fetching discarded text', async (mode) => {
        const {
            clock,
            store,
            scope,
        } = await setup();
        await store.endTurn(scope, 'writer', []);
        const rows = Array.from({ length: 205 }, (_value, index) => asValues<ConversationItemEntity>({
            scopeId: scope.id,
            generation: scope.generation,
            id: `item-${index}`,
            runId: 'writer',
            createdAt: clock.now(),
            role: 'user',
            text: 'discarded text',
            status: 'sent',
        }));
        await dataSource.getRepository(ConversationItemEntity).insert(rows);
        clock.advance(1000);
        const queries = vi.spyOn(dataSource.logger, 'logQuery');
        await store.prune({
            ...DEFAULT_CONVERSATION_LIMITS,
            ...(mode === 'age' ? { retentionMs: 1000 } : { maxStoredItems: 5 }),
        });
        const reads = queries.mock.calls.map(([query]) => query)
            .filter((query) => query.startsWith('SELECT') && query.includes('chamvi_conversation_items'));
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((query) => !query.includes('"text"'))).toBe(true);
        const remaining = await store.listItems(scope, { limit: 10, offset: 0 });
        expect(remaining.total).toBe(mode === 'age' ? 0 : 5);
    });

    it('keeps live note metadata on reset with one generation update and drops expired notes', async () => {
        const {
            clock,
            store,
            scope,
        } = await setup();
        for (const key of ['keep', 'expired']) {
            await store.applyNote(scope, {
                id: key,
                inputHash: key,
                kind: 'set',
                key,
                text: `body-${key}`,
                source: {
                    runId: 'writer',
                    toolCallId: key,
                    stepIndex: 0,
                },
                expiresAt: new Date(clock.now().getTime() + (key === 'expired' ? 1000 : 2000)),
            });
        }
        const note = await store.getNote(scope, 'keep');
        await store.endTurn(scope, 'writer', []);
        clock.advance(1000);
        const queries = vi.spyOn(dataSource.logger, 'logQuery');
        const next = await store.reset(scope.identity, { keepNotes: true });
        const writes = queries.mock.calls.map(([query]) => query)
            .filter((query) => query.includes('chamvi_conversation_notes'));
        expect(writes.filter((query) => query.startsWith('UPDATE'))).toHaveLength(1);
        expect(writes.some((query) => query.startsWith('INSERT'))).toBe(false);
        expect(writes.some((query) => query.startsWith('SELECT') && query.includes('"text"'))).toBe(false);
        expect(await store.getNote(next, 'keep')).toEqual(note);
        expect(await store.getNote(next, 'expired')).toBeUndefined();
        expect(await store.listNotes(scope, { limit: 10, offset: 0 })).toEqual({ data: [], total: 0 });
    });
});

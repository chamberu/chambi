/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { DataSource } from 'typeorm';
import {
    afterEach,
    beforeEach,
    expect,
    it,
} from 'vitest';
import { DEFAULT_CONVERSATION_LIMITS } from '@chamvi/core';
import type { ConversationIdentity } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { TypeormConversationStore, TypeormStore  } from '@chamvi/store-typeorm';
import { ConversationOperationEntity, ConversationTurnEntity } from '../../../src/entities/index.ts';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

const IDENTITY: ConversationIdentity = {
    agent: 'helper',
    channel: 'chat',
    account: 'main',
    chat: 'private-1',
    audience: 'direct',
};

// Independent connection pools ensure a process-local mutex cannot satisfy
// the conversation turn and generation serialization contract.
describePostgres('conversation transactions across connections', () => {
    let dataSource: DataSource;
    let peer: DataSource;
    let first: TypeormConversationStore;
    let second: TypeormConversationStore;

    beforeEach(async () => {
        dataSource = await createTestDataSource();
        peer = new DataSource(dataSource.options);
        await peer.initialize();
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00.000Z'));
        first = new TypeormConversationStore({ dataSource, clock });
        second = new TypeormConversationStore({ dataSource: peer, clock });
    });

    afterEach(async () => {
        if (peer?.isInitialized) await peer.destroy();
        if (dataSource?.isInitialized) await dataSource.destroy();
    });

    it('concurrent_connections_one_active_turn', async () => {
        const scopes = await Promise.all([first.resolve(IDENTITY), second.resolve(IDENTITY)]);
        expect(scopes[0]).toEqual(scopes[1]);
        const scope = scopes[0]!;
        const results = await Promise.all([
            first.beginTurn(scope, 'run-a', 'first', DEFAULT_CONVERSATION_LIMITS),
            second.beginTurn(scope, 'run-b', 'second', DEFAULT_CONVERSATION_LIMITS),
        ]);
        const winners = results.filter((result) => result.kind === 'ready');
        expect(winners).toHaveLength(1);
        const winner = winners[0]!;
        if (winner.kind !== 'ready') throw new TypeError('expected one ready turn');
        expect(results.filter((result) => result.kind === 'busy')).toEqual([
            { kind: 'busy', runId: winner.snapshot.runId },
        ]);
        const items = await second.listItems(scope, { limit: 100, offset: 0 });
        expect(items.total).toBe(1);
        expect(items.data[0]?.id).toBe(`user:${winner.snapshot.runId}`);
    });

    it('reset_versus_begin_serialized', async () => {
        const scope = await first.resolve(IDENTITY);
        const results = await Promise.allSettled([
            first.beginTurn(scope, 'run-a', 'first', DEFAULT_CONVERSATION_LIMITS),
            second.reset(IDENTITY, { keepNotes: false }),
        ]);
        const admission = results[0]!;
        const reset = results[1]!;
        expect(admission.status).toBe('fulfilled');
        if (admission.status !== 'fulfilled') throw new TypeError('admission failed');
        if (admission.value.kind === 'ready') {
            expect(reset.status).toBe('rejected');
            if (reset.status === 'rejected') expect(reset.reason).toMatchObject({ code: 'invalid_run_state' });
            expect(await second.get(IDENTITY)).toEqual(scope);
            expect((await first.listItems(scope, { limit: 100, offset: 0 })).total).toBe(1);
        } else {
            expect(admission.value).toEqual({ kind: 'stale' });
            expect(reset.status).toBe('fulfilled');
            expect((await second.get(IDENTITY))?.generation).toBe(scope.generation + 1);
            expect((await first.listItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
        }
    });

    it('delete_leaves_generation_tombstone_across_connections', async () => {
        const scope = await first.resolve(IDENTITY);
        await second.delete(IDENTITY);
        expect(await first.beginTurn(scope, 'old-run', 'stale', DEFAULT_CONVERSATION_LIMITS))
            .toEqual({ kind: 'stale' });
        const fresh = await first.resolve(IDENTITY);
        expect(fresh.id).toBe(scope.id);
        expect(fresh.generation).toBeGreaterThan(scope.generation);
        expect(await second.get(IDENTITY)).toEqual(fresh);
    });

    it('snapshot_input_owner_rollback_together', async () => {
        const scope = await first.resolve(IDENTITY);
        // A database constraint fails the final snapshot write after input/owner writes.
        await dataSource.query('ALTER TABLE chamvi_conversation_turns ADD CONSTRAINT fail_snapshot CHECK (run_id <> \'reject\')');
        await expect(first.beginTurn(scope, 'reject', 'input', DEFAULT_CONVERSATION_LIMITS)).rejects.toThrow();
        expect((await first.listItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect(await dataSource.getRepository(ConversationTurnEntity).count()).toBe(0);
        expect((await second.beginTurn(scope, 'allowed', 'input', DEFAULT_CONVERSATION_LIMITS)).kind).toBe('ready');
    });

    it('emit_collision_no_overwrite', async () => {
        const scope = await first.resolve(IDENTITY);
        await first.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS);
        const item = {
            id: 'emit',
            role: 'assistant' as const,
            text: 'answer',
            runId: 'run',
            createdAt: new Date(),
            status: 'pending' as const,
        };
        await first.prepareEmit(scope, item);
        await expect(second.prepareEmit(scope, { ...item, text: 'collision' })).rejects.toMatchObject({ code: 'validation_error' });
        expect((await first.pendingEmits(scope, 'run'))[0]?.text).toBe('answer');
    });

    it('note_operation_rollback_together', async () => {
        const scope = await first.resolve(IDENTITY);
        await first.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS);
        await dataSource.query('ALTER TABLE chamvi_conversation_operations ADD CONSTRAINT fail_operation CHECK (id <> \'reject\')');
        const operation = {
            id: 'reject',
            inputHash: 'hash',
            kind: 'set' as const,
            key: 'key',
            text: 'value',
            source: {
                runId: 'run',
                toolCallId: 'call',
                stepIndex: 0,
            },
        };
        await expect(first.applyNote(scope, operation)).rejects.toThrow();
        expect(await second.getNote(scope, 'key')).toBeUndefined();
        expect(await dataSource.getRepository(ConversationOperationEntity).count()).toBe(0);
        await expect(second.applyNote(scope, { ...operation, id: 'allowed' })).resolves.toMatchObject({ kind: 'set' });
    });

    it('deletion_cascades_owned_rows_not_runs', async () => {
        const scope = await first.resolve(IDENTITY);
        const audit = new TypeormStore({ dataSource });
        const now = new Date();
        await audit.createRun({
            id: 'retained',
            agent: 'helper',
            status: 'queued',
            trigger: {
                id: 'event',
                trigger: 'chat',
                agent: 'helper',
                channel: 'chat',
                payload: 'audit',
                receivedAt: now,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: now,
            updatedAt: now,
        });
        await first.beginTurn(scope, 'retained', 'input', DEFAULT_CONVERSATION_LIMITS);
        await first.applyNote(scope, {
            id: 'op',
            inputHash: 'hash',
            kind: 'set',
            key: 'key',
            text: 'value',
            source: {
                runId: 'retained',
                toolCallId: 'call',
                stepIndex: 0,
            },
        });
        await first.endTurn(scope, 'retained', []);
        await second.delete(IDENTITY);
        expect((await first.listItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect((await first.listNotes(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect(await dataSource.getRepository(ConversationTurnEntity).count()).toBe(0);
        expect(await dataSource.getRepository(ConversationOperationEntity).count()).toBe(0);
        expect(await audit.getRun('retained')).toBeDefined();
    });

    it('opaque_text_not_json_sanitized_into_new_identity', async () => {
        const firstScope = await first.resolve({ ...IDENTITY, chat: 'chat-é' });
        const secondScope = await second.resolve({ ...IDENTITY, chat: 'chat-é' });
        expect(firstScope.id).not.toBe(secondScope.id);
        expect(firstScope.identity.chat).toBe('chat-é');
        expect(secondScope.identity.chat).toBe('chat-é');
        await expect(first.resolve({ ...IDENTITY, chat: 'chat\u0000' }))
            .rejects.toMatchObject({ code: 'validation_error' });
        expect(await second.get(firstScope.identity)).toEqual(firstScope);
    });
});

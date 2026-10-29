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
import { TypeormRunRepository } from '@chamvi/store-db';
import { SeededConversationRepository } from '../../utils/conversation.ts';
import { ConversationEntity, ConversationOperationEntity } from '../../../src/entities/index.ts';
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
    let first: SeededConversationRepository;
    let second: SeededConversationRepository;

    beforeEach(async () => {
        dataSource = await createTestDataSource();
        peer = new DataSource(dataSource.options);
        await peer.initialize();
        const clock = new ControllableClock(new Date('2026-10-28T00:00:00.000Z'));
        first = new SeededConversationRepository({ dataSource, clock });
        second = new SeededConversationRepository({ dataSource: peer, clock });
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
        const items = await second.findItems(scope, { limit: 100, offset: 0 });
        expect(items.total).toBe(1);
        expect(items.data[0]?.id).toBe(`user:${winner.snapshot.runId}`);
    });

    it('keeps one active snapshot across connections and clears it with the owner', async () => {
        const scope = await first.resolve(IDENTITY);
        const initial = await first.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS);
        expect(await second.beginTurn(scope, 'run', 'input', DEFAULT_CONVERSATION_LIMITS)).toEqual(initial);
        const [active] = await dataSource.query('SELECT * FROM chamvi_conversations WHERE id = $1', [scope.id]);
        expect(active).toMatchObject({
            active_run_id: 'run',
            snapshot_messages: [],
            snapshot_item_ids: [],
            snapshot_note_keys: [],
            snapshot_omitted: 0,
        });
        expect(active.snapshot_created_at).toBeInstanceOf(Date);
        await first.endTurn(scope, 'other', []);
        expect(await second.activeRun(scope)).toBe('run');
        await first.endTurn(scope, 'run', []);
        const [ended] = await dataSource.query('SELECT * FROM chamvi_conversations WHERE id = $1', [scope.id]);
        expect(ended).toMatchObject({
            active_run_id: null,
            snapshot_messages: null,
            snapshot_item_ids: null,
            snapshot_note_keys: null,
            snapshot_created_at: null,
            snapshot_omitted: null,
        });
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
            expect(await second.findOne(IDENTITY)).toEqual(scope);
            expect((await first.findItems(scope, { limit: 100, offset: 0 })).total).toBe(1);
        } else {
            expect(admission.value).toEqual({ kind: 'stale' });
            expect(reset.status).toBe('fulfilled');
            expect((await second.findOne(IDENTITY))?.generation).toBe(scope.generation + 1);
            expect((await first.findItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
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
        expect(await second.findOne(IDENTITY)).toEqual(fresh);
    });

    it('snapshot_input_owner_rollback_together', async () => {
        const scope = await first.resolve(IDENTITY);
        // A database constraint fails the atomic owner/snapshot write after the input insert.
        await dataSource.query('ALTER TABLE chamvi_conversations ADD CONSTRAINT fail_snapshot CHECK (active_run_id <> \'reject\')');
        await expect(first.beginTurn(scope, 'reject', 'input', DEFAULT_CONVERSATION_LIMITS)).rejects.toThrow();
        expect((await first.findItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect(await dataSource.getRepository(ConversationEntity).findOneByOrFail({ id: scope.id }))
            .toMatchObject({
                activeRunId: null,
                snapshotMessages: null,
                snapshotCreatedAt: null,
            });
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
        expect(await second.findOneNote(scope, 'key')).toBeUndefined();
        expect(await dataSource.getRepository(ConversationOperationEntity).count()).toBe(0);
        await expect(second.applyNote(scope, { ...operation, id: 'allowed' })).resolves.toMatchObject({ kind: 'set' });
    });

    it('deletion_cascades_owned_rows_not_runs', async () => {
        const scope = await first.resolve(IDENTITY);
        const audit = new TypeormRunRepository({ dataSource });
        const now = new Date();
        await audit.insert({
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
        expect((await first.findItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect((await first.findNotes(scope, { limit: 100, offset: 0 })).total).toBe(0);
        expect(await dataSource.getRepository(ConversationEntity).findOneByOrFail({ id: scope.id }))
            .toMatchObject({
                activeRunId: null,
                snapshotMessages: null,
                snapshotCreatedAt: null,
            });
        expect(await dataSource.getRepository(ConversationOperationEntity).count()).toBe(0);
        expect(await audit.findOne('retained')).toBeDefined();
    });

    it('opaque_text_not_json_sanitized_into_new_identity', async () => {
        const firstScope = await first.resolve({ ...IDENTITY, chat: 'chat-é' });
        const secondScope = await second.resolve({ ...IDENTITY, chat: 'chat-é' });
        expect(firstScope.id).not.toBe(secondScope.id);
        expect(firstScope.identity.chat).toBe('chat-é');
        expect(secondScope.identity.chat).toBe('chat-é');
        await expect(first.resolve({ ...IDENTITY, chat: 'chat\u0000' }))
            .rejects.toMatchObject({ code: 'validation_error' });
        expect(await second.findOne(firstScope.identity)).toEqual(firstScope);
    });
});

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    CONVERSATION_NOTES_MAX,
    CONVERSATION_NOTE_KEY_MAX_LENGTH,
    CONVERSATION_NOTE_TEXT_MAX_BYTES,
    DEFAULT_CONVERSATION_LIMITS,
    MemoryConversationRepository,
} from '@chamvi/core';
import type {
    ConversationIdentity,
    ConversationNoteOperation,
    IConversationRepository,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';

const LIMITS = { ...DEFAULT_CONVERSATION_LIMITS };

const identity = (chat = 'chat-1'): ConversationIdentity => ({
    agent: 'helper',
    channel: 'openclaw',
    account: 'main',
    chat,
    audience: 'direct',
});

const setOp = (
    runId: string,
    key: string,
    text: string,
    call = 'call-1',
): Extract<ConversationNoteOperation, { kind: 'set' }> => ({
    id: `${runId}:0:${call}:0`,
    inputHash: `h:${key}:${text}`,
    source: {
        runId,
        toolCallId: call,
        stepIndex: 0,
    },
    kind: 'set',
    key,
    text,
});

describe('MemoryConversationRepository', () => {
    it('implements IConversationRepository on the system clock by default', async () => {
        const store: IConversationRepository = new MemoryConversationRepository();
        const scope = await store.resolve(identity());
        const before = Date.now();
        const begun = await store.beginTurn(scope, 'run-a', 'hello', LIMITS);

        expect(begun.kind).toBe('ready');

        if (begun.kind === 'ready') {
            expect(begun.snapshot.createdAt.getTime()).toBeGreaterThanOrEqual(before);
        }
    });

    it('exposes the note bounds as constants', () => {
        expect(CONVERSATION_NOTES_MAX).toBe(100);
        expect(CONVERSATION_NOTE_KEY_MAX_LENGTH).toBe(128);
        expect(CONVERSATION_NOTE_TEXT_MAX_BYTES).toBe(2048);
    });

    it('releases its snapshot at terminal settlement and refuses a retained ended input', async () => {
        const store = new MemoryConversationRepository({ clock: new ControllableClock() });
        const scope = await store.resolve(identity());

        await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
        await store.endTurn(scope, 'run-a', []);
        await expect(store.beginTurn(scope, 'run-a', 'hello', LIMITS)).rejects.toMatchObject({ code: 'invalid_run_state' });
        expect((await store.findItems(scope, { limit: 10, offset: 0 })).total).toBe(1);
        expect((await store.beginTurn(scope, 'run-b', 'next', LIMITS)).kind).toBe('ready');
    });

    it('refuses a malformed scope or run id before any state change', async () => {
        const store = new MemoryConversationRepository({ clock: new ControllableClock() });
        const scope = await store.resolve(identity());

        await expect(store.beginTurn({ ...scope, id: 'nope' }, 'run-a', 'hi', LIMITS))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.beginTurn({ ...scope, generation: -1 }, 'run-a', 'hi', LIMITS))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.beginTurn(scope, '', 'hi', LIMITS)).rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.beginTurn(scope, 'run-a', '', LIMITS)).rejects.toMatchObject({ code: 'validation_error' });
        expect((await store.findItems(scope, { limit: 10, offset: 0 })).total).toBe(0);

        // a scope of an identity never resolved here is stale
        const other = { ...scope, id: 'f'.repeat(64) };

        expect(await store.beginTurn(other, 'run-a', 'hi', LIMITS)).toEqual({ kind: 'stale' });
        await expect(store.applyNote(scope, { ...setOp('run-a', 'k', 'v'), kind: 'other' } as never))
            .rejects.toMatchObject({ code: 'invalid_run_state' });
    });

    it('validates a note operation of the active run', async () => {
        const store = new MemoryConversationRepository({ clock: new ControllableClock() });
        const scope = await store.resolve(identity());

        await store.beginTurn(scope, 'run-a', 'hi', LIMITS);
        await expect(store.applyNote(scope, { ...setOp('run-a', 'k', 'v'), kind: 'other' } as never))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.applyNote(scope, { ...setOp('run-a', 'k', 'v'), id: '' }))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.applyNote(scope, { ...setOp('run-a', 'k', 'v'), inputHash: '' }))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.applyNote(scope, setOp('run-a', 'k', 'a\0b')))
            .rejects.toMatchObject({ code: 'validation_error' });
        await expect(store.applyNote(scope, { ...setOp('run-a', 'k', 'v'), expiresAt: new Date(NaN) }))
            .rejects.toMatchObject({ code: 'validation_error' });
        expect(await store.findOneNote(scope, 'k')).toBeUndefined();
    });

    it('keeps an operation record whose run became active again during the settled lookup', async () => {
        const clock = new ControllableClock();
        const store = new MemoryConversationRepository({ clock });
        const scope = await store.resolve(identity());
        const limits = { ...LIMITS, retentionMs: 1000 };

        await store.beginTurn(scope, 'run-a', 'hi', limits);

        const op = setOp('run-a', 'k', 'v');
        const first = await store.applyNote(scope, op);

        await store.endTurn(scope, 'run-a', []);
        clock.advance(1000);
        await store.prune(limits, {
            isSettled: async () => {
                // the run takes the scope back (engine-invalid, but the prune must re-check after its await)
                await store.beginTurn(scope, 'run-a', 'hi', limits);

                return true;
            },
        });
        clock.advance(5);
        expect(await store.applyNote(scope, op)).toEqual(first);
    });

    it('endTurn of a stale generation is a no-op', async () => {
        const store = new MemoryConversationRepository({ clock: new ControllableClock() });
        const scope = await store.resolve(identity());

        await store.beginTurn(scope, 'run-a', 'hi', LIMITS);
        await store.endTurn({ ...scope, generation: 3 }, 'run-a', []);
        expect(await store.beginTurn(scope, 'run-b', 'x', LIMITS)).toEqual({ kind: 'busy', runId: 'run-a' });
        expect(await store.pendingEmits({ ...scope, generation: 3 }, 'run-a')).toEqual([]);
    });
});

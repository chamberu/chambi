/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import type { IConversationRepository, ResolvedConversationLimits } from '@chamvi/core';
import { ControllableClock } from '../clock/index.ts';
import {
    LIMITS,
    completeTurn,
    makeEmit,
    makeIdentity,
    makeRemove,
    makeSet,
} from './helpers.ts';

const STATE = { code: 'invalid_run_state' };
const INVALID = { code: 'validation_error' };

/**
 * Shared behavioural contract for every IConversationRepository implementation.
 *
 * @param create Factory for a fresh, empty store. It MUST take every date and
 *               expiry decision from the given clock (e.g.
 *               `(clock) => new MemoryConversationRepository({ clock })`).
 */
export function describeConversationRepositoryContract(
    create: (clock: ControllableClock) => IConversationRepository | Promise<IConversationRepository>,
): void {
    const setup = async () => {
        const clock = new ControllableClock(new Date('2026-01-01T00:00:00.000Z'));
        const store = await create(clock);
        const identity = makeIdentity();
        const scope = await store.resolve(identity);
        return {
            clock,
            store,
            identity,
            scope,
        };
    };

    describe('conversation repository contract', () => {
        it('OrFail queries reject absent identities, notes and empty pages without creating them', async () => {
            const {
                store,
                identity,
                scope,
            } = await setup();
            await expect(store.findOneOrFail(makeIdentity('missing'))).rejects.toMatchObject({ code: 'repository_not_found' });
            expect(await store.findOne(makeIdentity('missing'))).toBeUndefined();
            expect(await store.findOneOrFail(identity)).toEqual(scope);
            await expect(store.findOneNoteOrFail(scope, 'missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(store.findItemsOrFail(scope, { limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(store.findNotesOrFail(scope, { limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada'));
            await expect(store.findItemsOrFail(scope, { limit: 10, offset: 1 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(store.findItemsOrFail(scope, { limit: 0, offset: 0 })).rejects.toMatchObject(INVALID);
            await expect(store.findNotesOrFail(scope, { limit: 10, offset: 1 })).rejects.toMatchObject({ code: 'repository_not_found' });
            expect(await store.findNotes(scope, { limit: 10, offset: 1 })).toEqual({ data: [], total: 1 });
            await expect(store.findItemsOrFail(scope, { limit: -1, offset: 0 })).rejects.toMatchObject(INVALID);
        });

        it('OrFail queries preserve copies, expiry and generation fences', async () => {
            const {
                store,
                identity,
                scope,
                clock,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada', { expiresAt: new Date(clock.now().getTime() + 1_000) }));
            const found = await store.findOneOrFail(identity);
            found.identity.chat = 'changed';
            expect(await store.findOneOrFail(identity)).toEqual(scope);
            const note = await store.findOneNoteOrFail(scope, 'name');
            expect(note.text).toBe('Ada');
            note.text = 'changed';
            expect((await store.findOneNoteOrFail(scope, 'name')).text).toBe('Ada');
            expect((await store.findItemsOrFail(scope, { limit: 10, offset: 0 })).data.map((item) => item.text)).toEqual(['hello']);
            expect((await store.findNotesOrFail(scope, { limit: 10, offset: 0 })).data.map((item) => item.text)).toEqual(['Ada']);
            clock.advance(1_000);
            await expect(store.findOneNoteOrFail(scope, 'name')).rejects.toMatchObject({ code: 'repository_not_found' });
            await store.endTurn(scope, 'run-a', []);
            const next = await store.reset(identity, { keepNotes: false });
            await expect(store.findItemsOrFail(next, { limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(store.findNotesOrFail(scope, { limit: 10, offset: 0 })).rejects.toMatchObject({ code: 'repository_not_found' });
        });

        it('resolve creates generation 0 once and findOne reads without creating', async () => {
            const {
                store,
                identity,
                scope,
            } = await setup();
            expect(scope.generation).toBe(0);
            expect(scope.id).toMatch(/^[0-9a-f]{64}$/);
            expect(scope.identity).toEqual(identity);
            expect(await store.resolve({ ...identity })).toEqual(scope);
            expect(await store.findOne(identity)).toEqual(scope);
            expect(await store.findOne(makeIdentity('unknown'))).toBeUndefined();
            expect(await store.findOne(makeIdentity('unknown'))).toBeUndefined();
            await expect(store.resolve(makeIdentity(''))).rejects.toMatchObject(INVALID);
        });

        it('activeRun is read-only, generation fenced and cleared by endTurn', async () => {
            const {
                store,
                scope,
                identity,
            } = await setup();
            expect(await store.activeRun(scope)).toBeUndefined();
            await store.beginTurn(scope, 'run', 'hello', LIMITS);
            expect(await store.activeRun(scope)).toBe('run');
            await store.endTurn(scope, 'run', []);
            expect(await store.activeRun(scope)).toBeUndefined();
            await store.reset(identity, { keepNotes: false });
            expect(await store.activeRun(scope)).toBeUndefined();
        });

        it('rejects unsupported Unicode in stored opaque strings without changing state', async () => {
            const {
                store,
                scope,
                clock,
            } = await setup();
            await expect(store.beginTurn(scope, 'run\ud800', 'hello', LIMITS)).rejects.toMatchObject(INVALID);
            await store.beginTurn(scope, 'run', 'hello', LIMITS);
            const item = makeEmit(clock, 'run', 0, 'reply');
            for (const changed of [
                { ...item, id: 'bad\ud800' },
                { ...item, effectKey: 'bad\ud800' },
                { ...item, target: { channel: 'bad\ud800', address: 'chat' } },
                { ...item, target: { channel: 'chat', address: 'bad\u0000' } },
                { ...item, target: { channel: 'chat', address: 'bad\ud800' } },
            ]) await expect(store.prepareEmit(scope, changed)).rejects.toMatchObject(INVALID);
            const operation = makeSet('run', 'note', 'value');
            for (const changed of [
                { ...operation, id: 'bad\ud800' },
                { ...operation, inputHash: 'bad\ud800' },
                { ...operation, source: { ...operation.source, toolCallId: 'bad\ud800' } },
            ]) await expect(store.applyNote(scope, changed)).rejects.toMatchObject(INVALID);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).total).toBe(1);
            expect((await store.findNotes(scope, { limit: 100, offset: 0 })).total).toBe(0);
        });

        it('begin_is_atomic_across_callers', async () => {
            const { store, scope } = await setup();
            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) => store.beginTurn(scope, `run-${i}`, `hello ${i}`, LIMITS)),
            );
            const ready = results.filter((r) => r.kind === 'ready');
            expect(ready).toHaveLength(1);
            const winner = ready[0]!.kind === 'ready' ? ready[0]!.snapshot.runId : '';
            expect(results.filter((r) => r.kind === 'busy')).toHaveLength(9);
            for (const result of results) {
                if (result.kind === 'busy') expect(result.runId).toBe(winner);
            }
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.total).toBe(1);
            expect(items.data[0]).toMatchObject({
                id: `user:${winner}`,
                role: 'user',
                status: 'sent',
            });
        });

        it('same_run_reuses_snapshot', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await completeTurn(store, clock, scope, 'run-0', 'earlier', ['reply']);
            const first = await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            clock.advance(5000);
            await store.prepareEmit(scope, makeEmit(clock, 'run-a', 0, 'not yet sent'));
            const second = await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            expect(first.kind).toBe('ready');
            expect(second).toEqual(first);
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.filter((item) => item.id === 'user:run-a')).toHaveLength(1);
            expect(items.total).toBe(4);
        });

        it('active_snapshot_survives_stricter_limits_on_resume', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await completeTurn(store, clock, scope, 'run-0', 'earlier', ['reply']);
            const first = await store.beginTurn(scope, 'run-a', 'accepted text', LIMITS);
            expect(first.kind).toBe('ready');
            clock.advance(5000);
            const stricter = {
                ...LIMITS,
                maxItemBytes: 4,
                maxHistoryBytes: 4,
                retentionMs: 1,
            };
            await expect(store.beginTurn(scope, 'run-a', 'accepted text', stricter)).resolves.toEqual(first);
            await store.endTurn(scope, 'run-a', []);
            await expect(store.beginTurn(scope, 'run-b', 'new oversized input', stricter)).rejects.toMatchObject(INVALID);
        });

        it('ended_turn_does_not_reclaim_its_retained_input', async () => {
            const { store, scope } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            await store.endTurn(scope, 'run-a', []);
            await expect(store.beginTurn(scope, 'run-a', 'hello', LIMITS)).rejects.toMatchObject({ code: 'invalid_run_state' });
            expect((await store.findItems(scope, { limit: 10, offset: 0 })).total).toBe(1);
            expect((await store.beginTurn(scope, 'run-b', 'next', LIMITS)).kind).toBe('ready');
        });

        it('busy_does_not_append_input', async () => {
            const { store, scope } = await setup();
            await store.beginTurn(scope, 'run-a', 'first', LIMITS);
            expect(await store.beginTurn(scope, 'run-b', 'second', LIMITS)).toEqual({ kind: 'busy', runId: 'run-a' });
            let items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.map((item) => item.id)).toEqual(['user:run-a']);

            await store.endTurn(scope, 'run-a', []);
            expect((await store.beginTurn(scope, 'run-b', 'second', LIMITS)).kind).toBe('ready');
            // a settled owner retrying with its snapshot never takes the scope back from the active one
            expect(await store.beginTurn(scope, 'run-a', 'first', LIMITS)).toEqual({ kind: 'busy', runId: 'run-b' });
            items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.map((item) => item.id)).toEqual(['user:run-a', 'user:run-b']);
        });

        it('end_is_owner_guarded', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'first', LIMITS);
            const confirmed = makeEmit(clock, 'run-a', 0, 'confirmed');
            const lost = makeEmit(clock, 'run-a', 1, 'uncertain');
            await store.prepareEmit(scope, confirmed);
            await store.prepareEmit(scope, lost);

            await store.endTurn(scope, 'run-b', [confirmed.id, lost.id]);
            expect(await store.beginTurn(scope, 'run-c', 'third', LIMITS)).toEqual({ kind: 'busy', runId: 'run-a' });
            expect((await store.pendingEmits(scope, 'run-a')).map((item) => item.id)).toEqual([confirmed.id, lost.id]);

            await store.endTurn(scope, 'run-a', [confirmed.id]);
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.map((item) => [item.id, item.status])).toEqual([
                ['user:run-a', 'sent'],
                [confirmed.id, 'sent'],
                [lost.id, 'unknown'],
            ]);
            expect(await store.pendingEmits(scope, 'run-a')).toEqual([]);

            // a repeated end is a no-op, and unknown is terminal
            await store.endTurn(scope, 'run-a', [lost.id]);
            expect((await store.beginTurn(scope, 'run-c', 'third', LIMITS)).kind).toBe('ready');
            await store.endTurn(scope, 'run-c', [lost.id]);
            const after = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(after.data.find((item) => item.id === lost.id)?.status).toBe('unknown');
        });

        it('two_scope_identities_isolate', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            const other = await store.resolve(makeIdentity('chat-1', { audience: 'group' }));
            expect(other.id).not.toBe(scope.id);

            expect((await store.beginTurn(scope, 'run-a', 'mine', LIMITS)).kind).toBe('ready');
            expect((await store.beginTurn(other, 'run-b', 'theirs', LIMITS)).kind).toBe('ready');
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada'));
            await store.prepareEmit(scope, makeEmit(clock, 'run-a', 0, 'hi Ada'));
            await expect(store.applyNote(other, makeSet('run-a', 'name', 'Eve'))).rejects.toMatchObject(STATE);
            await expect(store.prepareEmit(other, makeEmit(clock, 'run-a', 1, 'x'))).rejects.toMatchObject(STATE);

            expect((await store.findItems(other, { limit: 100, offset: 0 })).data.map((i) => i.id)).toEqual(['user:run-b']);
            expect((await store.findNotes(other, { limit: 100, offset: 0 })).total).toBe(0);
            expect(await store.findOneNote(other, 'name')).toBeUndefined();
            expect((await store.findOneNote(scope, 'name'))?.text).toBe('Ada');
        });

        it('reset_races_begin', async () => {
            for (const order of ['begin-first', 'reset-first'] as const) {
                const {
                    store,
                    identity,
                    scope,
                } = await setup();
                const begin = () => store.beginTurn(scope, 'run-a', 'hello', LIMITS);
                const reset = () => store.reset(identity, { keepNotes: false });
                let beginResult: PromiseSettledResult<Awaited<ReturnType<typeof begin>>>;
                let resetResult: PromiseSettledResult<unknown>;
                if (order === 'begin-first') {
                    [beginResult, resetResult] = await Promise.allSettled([begin(), reset()]);
                } else {
                    [resetResult, beginResult] = await Promise.allSettled([reset(), begin()]);
                }
                const ready = beginResult.status === 'fulfilled' && beginResult.value.kind === 'ready';
                expect(ready !== (resetResult.status === 'fulfilled')).toBe(true);
                if (!ready) {
                    expect(beginResult).toMatchObject({ status: 'fulfilled', value: { kind: 'stale' } });
                }
            }
        });

        it('delete_leaves_generation_tombstone', async () => {
            const {
                store,
                clock,
                identity,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'remember me', LIMITS);
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada'));
            await store.prepareEmit(scope, makeEmit(clock, 'run-a', 0, 'ok'));
            await store.endTurn(scope, 'run-a', ['assistant:run-a:0']);

            await store.delete(identity);
            const current = await store.findOne(identity);
            expect(current?.generation).toBeGreaterThan(scope.generation);
            expect(await store.resolve(identity)).toEqual(current);

            expect(await store.beginTurn(scope, 'run-b', 'old queued work', LIMITS)).toEqual({ kind: 'stale' });
            await expect(store.prepareEmit(scope, makeEmit(clock, 'run-b', 0, 'x'))).rejects.toMatchObject(STATE);
            await expect(store.applyNote(scope, makeSet('run-b', 'k', 'v'))).rejects.toMatchObject(STATE);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).total).toBe(0);
            expect((await store.findItems(current!, { limit: 100, offset: 0 })).total).toBe(0);
            expect((await store.findNotes(current!, { limit: 100, offset: 0 })).total).toBe(0);
            expect(await store.findOneNote(current!, 'name')).toBeUndefined();

            const ready = await store.beginTurn(current!, 'run-c', 'fresh', LIMITS);
            expect(ready).toMatchObject({
                kind: 'ready',
                snapshot: {
                    messages: [],
                    itemIds: [],
                    noteKeys: [],
                },
            });

            // deleting an identity never seen is a no-op that creates nothing
            await store.delete(makeIdentity('never'));
            expect(await store.findOne(makeIdentity('never'))).toBeUndefined();
        });

        it('reset_rejects_array_options_without_advancing_generation', async () => {
            const {
                store,
                identity,
                scope,
            } = await setup();
            await expect(store.reset(identity, Object.assign([], { keepNotes: true }))).rejects.toMatchObject(INVALID);
            expect(await store.findOne(identity)).toEqual(scope);
        });

        it('reset_refuses_active', async () => {
            const {
                store,
                identity,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada'));
            await expect(store.reset(identity, { keepNotes: false })).rejects.toMatchObject(STATE);
            await expect(store.delete(identity)).rejects.toMatchObject(STATE);
            expect(await store.findOne(identity)).toEqual(scope);
            await store.endTurn(scope, 'run-a', []);

            const dropped = await store.reset(identity, { keepNotes: false });
            expect(dropped.generation).toBeGreaterThan(scope.generation);
            expect((await store.findNotes(dropped, { limit: 100, offset: 0 })).total).toBe(0);
            expect(await store.beginTurn(scope, 'run-b', 'old', LIMITS)).toEqual({ kind: 'stale' });

            const second = await setup();
            await second.store.beginTurn(second.scope, 'run-a', 'hello', LIMITS);
            await second.store.applyNote(second.scope, makeSet('run-a', 'name', 'Ada', { inputHash: 'h1' }));
            await second.store.endTurn(second.scope, 'run-a', []);
            const kept = await second.store.reset(second.identity, { keepNotes: true });
            expect((await second.store.findNotes(kept, { limit: 100, offset: 0 })).data.map((n) => [n.key, n.text]))
                .toEqual([['name', 'Ada']]);
            // the old generation's operation record grants no replay in the new one
            expect((await second.store.beginTurn(kept, 'run-a', 'again', LIMITS)).kind).toBe('ready');
            const result = await second.store.applyNote(kept, makeSet('run-a', 'name', 'Grace', { inputHash: 'h2' }));
            expect(result).toMatchObject({ kind: 'set', key: 'name' });
            expect((await second.store.findOneNote(kept, 'name'))?.text).toBe('Grace');
            // old transcript items are not part of the new generation
            expect((await second.store.findItems(kept, { limit: 100, offset: 0 })).data.map((i) => i.id))
                .toEqual(['user:run-a']);
        });

        it('notes_replay_once_hash_collision_refused', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            const set = makeSet('run-a', 'name', 'Ada');
            const created = await store.applyNote(scope, set);
            expect(created).toEqual({
                kind: 'set',
                key: 'name',
                updatedAt: clock.now(),
            });
            expect(created).not.toHaveProperty('text');
            const createdAt = created.kind === 'set' ? created.updatedAt : undefined;

            clock.advance(1000);
            expect(await store.applyNote(scope, set)).toEqual(created);
            const note = await store.findOneNote(scope, 'name');
            expect(note).toMatchObject({
                text: 'Ada',
                updatedAt: createdAt,
                source: set.source,
            });
            await expect(store.applyNote(scope, {
                ...set,
                inputHash: 'other',
                text: 'Eve',
            }))
                .rejects.toMatchObject(INVALID);
            expect((await store.findOneNote(scope, 'name'))?.text).toBe('Ada');

            const update = makeSet('run-a', 'name', 'Grace', { toolCallId: 'call-2', stepIndex: 1 });
            const updated = await store.applyNote(scope, update);
            expect(updated).toEqual({
                kind: 'set',
                key: 'name',
                updatedAt: clock.now(),
            });
            expect(await store.findOneNote(scope, 'name')).toMatchObject({
                text: 'Grace',
                createdAt,
                updatedAt: clock.now(),
            });

            const remove = makeRemove('run-a', 'name');
            expect(await store.applyNote(scope, remove)).toEqual({
                kind: 'remove',
                key: 'name',
                removed: true,
            });
            expect(await store.applyNote(scope, remove)).toEqual({
                kind: 'remove',
                key: 'name',
                removed: true,
            });
            expect(await store.applyNote(scope, makeRemove('run-a', 'name', 'call-3')))
                .toEqual({
                    kind: 'remove',
                    key: 'name',
                    removed: false,
                });
            expect(await store.findOneNote(scope, 'name')).toBeUndefined();

            // no write and no replay without the run's active ownership
            await expect(store.applyNote(scope, makeSet('run-b', 'k', 'v'))).rejects.toMatchObject(STATE);
            await store.endTurn(scope, 'run-a', []);
            await expect(store.applyNote(scope, set)).rejects.toMatchObject(STATE);
            expect(await store.findOneNote(scope, 'name')).toBeUndefined();
        });

        it('note operations are bounded and validated', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            for (let i = 0; i < 100; i++) {
                await store.applyNote(scope, makeSet('run-a', `k${i}`, 'v'));
            }
            await expect(store.applyNote(scope, makeSet('run-a', 'k100', 'v'))).rejects.toMatchObject(INVALID);
            expect((await store.findNotes(scope, { limit: 200, offset: 0 })).total).toBe(100);
            // updating an existing note at the cap is fine
            await store.applyNote(scope, makeSet('run-a', 'k0', 'w', { toolCallId: 'again' }));
            await expect(store.applyNote(scope, makeSet('run-a', '', 'v'))).rejects.toMatchObject(INVALID);
            await expect(store.applyNote(scope, makeSet('run-a', 'k'.repeat(129), 'v'))).rejects.toMatchObject(INVALID);
            await expect(store.applyNote(scope, makeSet('run-a', 'a\nb', 'v'))).rejects.toMatchObject(INVALID);
            await expect(store.applyNote(scope, makeSet('run-a', 'k0', 'é'.repeat(1025), { toolCallId: 'long' })))
                .rejects.toMatchObject(INVALID);
            await expect(store.applyNote(scope, makeSet('run-a', 'k0', 'v', { toolCallId: 'past', expiresAt: clock.now() })))
                .rejects.toMatchObject(INVALID);
            // a refused operation records nothing: the same id applies once valid
            expect(await store.applyNote(scope, makeSet('run-a', 'k0', 'w', { toolCallId: 'long' })))
                .toMatchObject({ kind: 'set', key: 'k0' });
            const page = await store.findNotes(scope, { limit: 2, offset: 1 });
            expect(page.total).toBe(100);
            expect(page.data.map((n) => n.key)).toEqual(['k1', 'k10']);
        });

        it('pending_send_not_recalled', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'question', LIMITS);
            const sent = makeEmit(clock, 'run-a', 0, 'sent answer');
            const uncertain = makeEmit(clock, 'run-a', 1, 'uncertain answer');
            await store.prepareEmit(scope, sent);
            await store.prepareEmit(scope, sent);
            await store.prepareEmit(scope, uncertain);
            await expect(store.prepareEmit(scope, { ...sent, text: 'changed' })).rejects.toMatchObject(INVALID);
            await expect(store.prepareEmit(scope, { ...sent, target: { channel: 'openclaw', address: 'x' } }))
                .rejects.toMatchObject(INVALID);
            await expect(store.prepareEmit(scope, { ...sent, effectKey: 'other' })).rejects.toMatchObject(INVALID);
            await expect(store.prepareEmit(scope, { ...sent, runId: 'run-b' })).rejects.toMatchObject(STATE);
            await store.confirmEmit(scope, sent.id);
            await store.confirmEmit(scope, sent.id);
            await expect(store.confirmEmit(scope, 'assistant:none')).rejects.toMatchObject(STATE);

            const before = await store.beginTurn(scope, 'run-x', 'busy', LIMITS);
            expect(before.kind).toBe('busy');
            expect((await store.pendingEmits(scope, 'run-a')).map((item) => item.id)).toEqual([uncertain.id]);
            await store.endTurn(scope, 'run-a', []);
            await expect(store.confirmEmit(scope, uncertain.id)).rejects.toMatchObject(STATE);

            const next = await store.beginTurn(scope, 'run-b', 'follow-up', LIMITS);
            if (next.kind !== 'ready') throw new TypeError('expected ready');
            expect(next.snapshot.itemIds).toEqual(['user:run-a', sent.id]);
            expect(next.snapshot.messages).toEqual([
                { role: 'user', content: 'question' },
                { role: 'assistant', content: 'sent answer' },
            ]);
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.find((item) => item.id === uncertain.id)?.status).toBe('unknown');
            expect(items.data.filter((item) => item.id === sent.id)).toHaveLength(1);
        });

        it('expired_notes_ignored_at_exact_time', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await store.beginTurn(scope, 'run-a', 'hello', LIMITS);
            await store.applyNote(scope, makeSet('run-a', 'temp', 'short-lived', { expiresAt: new Date(clock.now().getTime() + 1000) }));
            await store.applyNote(scope, makeSet('run-a', 'keep', 'forever'));
            await store.endTurn(scope, 'run-a', []);

            clock.advance(999);
            expect((await store.findOneNote(scope, 'temp'))?.text).toBe('short-lived');
            const held = await store.beginTurn(scope, 'run-b', 'still there?', LIMITS);
            if (held.kind !== 'ready') throw new TypeError('expected ready');
            expect(held.snapshot.noteKeys).toEqual(['keep', 'temp']);

            clock.advance(1);
            expect(await store.findOneNote(scope, 'temp')).toBeUndefined();
            expect((await store.findNotes(scope, { limit: 100, offset: 0 })).data.map((n) => n.key)).toEqual(['keep']);
            // the snapshot taken earlier is immutable
            expect(await store.beginTurn(scope, 'run-b', 'still there?', LIMITS)).toEqual(held);
            await store.endTurn(scope, 'run-b', []);
            const next = await store.beginTurn(scope, 'run-c', 'gone?', LIMITS);
            if (next.kind !== 'ready') throw new TypeError('expected ready');
            expect(next.snapshot.noteKeys).toEqual(['keep']);
            expect(JSON.stringify(next.snapshot.messages)).not.toContain('short-lived');
        });

        it('expires transcript items at exactly createdAt + retentionMs', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            const limits: ResolvedConversationLimits = { ...LIMITS, retentionMs: 10_000 };
            await completeTurn(store, clock, scope, 'run-a', 'old', ['old reply'], limits);
            clock.advance(9999);
            await completeTurn(store, clock, scope, 'run-b', 'recent', [], limits);
            const recalled = await store.beginTurn(scope, 'run-c', 'now', limits);
            if (recalled.kind !== 'ready') throw new TypeError('expected ready');
            expect(recalled.snapshot.itemIds).toEqual(['user:run-a', 'assistant:run-a:0', 'user:run-b']);
            await store.endTurn(scope, 'run-c', []);

            clock.advance(1);
            const trimmed = await store.beginTurn(scope, 'run-d', 'later', limits);
            if (trimmed.kind !== 'ready') throw new TypeError('expected ready');
            expect(trimmed.snapshot.itemIds).toEqual(['user:run-b', 'user:run-c']);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).data.map((i) => i.id))
                .toEqual(['user:run-b', 'user:run-c', 'user:run-d']);
        });

        it('trim_inactive_via_prune', async () => {
            const {
                store,
                clock,
                identity,
                scope,
            } = await setup();
            const limits: ResolvedConversationLimits = { ...LIMITS, retentionMs: 10_000 };
            await completeTurn(store, clock, scope, 'run-a', 'old', ['old reply'], limits);
            await store.beginTurn(scope, 'run-b', 'active', limits);
            await store.applyNote(scope, makeSet('run-b', 'temp', 't', { expiresAt: new Date(clock.now().getTime() + 5) }));
            const other = await store.resolve(makeIdentity('chat-2'));
            await completeTurn(store, clock, other, 'run-o', 'other', [], limits);
            await store.reset(makeIdentity('chat-2'), { keepNotes: true });
            // reset is no erasure: the old generation keeps its records until retention removes them
            expect((await store.findItems(other, { limit: 100, offset: 0 })).total).toBe(1);

            clock.advance(10_000);
            await store.prune(limits);
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            // the active turn keeps its input
            expect(items.data.map((item) => item.id)).toEqual(['user:run-b']);
            expect((await store.findItems(other, { limit: 100, offset: 0 })).total).toBe(0);
            expect(await store.findOne(identity)).toEqual(scope);
            // the active turn's snapshot survives the prune
            expect((await store.beginTurn(scope, 'run-b', 'active', limits)).kind).toBe('ready');
            expect((await store.findNotes(scope, { limit: 100, offset: 0 })).total).toBe(0);

            // maxStoredItems keeps the newest records of a generation
            await store.endTurn(scope, 'run-b', []);
            const capped: ResolvedConversationLimits = { ...limits, maxStoredItems: 3 };
            for (const run of ['run-c', 'run-d', 'run-e']) {
                await completeTurn(store, clock, scope, run, run, [`${run} reply`], limits);
            }
            await store.prune(capped);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).data.map((i) => i.id))
                .toEqual(['assistant:run-d:0', 'user:run-e', 'assistant:run-e:0']);
            // begin trims too, never dropping the new input
            await completeTurn(store, clock, scope, 'run-f', 'f', ['f reply'], capped);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).data.map((i) => i.id))
                .toEqual(['user:run-e', 'assistant:run-e:0', 'user:run-f', 'assistant:run-f:0']);
        });

        it('prunes note operation records only for settled runs past retention', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            const limits: ResolvedConversationLimits = { ...LIMITS, retentionMs: 10_000 };
            await store.beginTurn(scope, 'run-a', 'hello', limits);
            await store.applyNote(scope, makeSet('run-a', 'name', 'Ada'));
            await store.endTurn(scope, 'run-a', []);
            await store.beginTurn(scope, 'run-b', 'hello', limits);
            await store.applyNote(scope, makeSet('run-b', 'city', 'Rome'));

            const young = vi.fn<(runId: string) => Promise<boolean>>(async () => true);
            await store.prune(limits, { isSettled: young });
            expect(young).not.toHaveBeenCalled();

            clock.advance(10_000);
            const failing = vi.fn<(runId: string) => Promise<boolean>>(async () => {
                throw new TypeError('lookup failed');
            });
            await expect(store.prune(limits, { isSettled: failing })).rejects.toThrow('lookup failed');
            // the active run is never asked
            expect(failing.mock.calls.map(([runId]) => runId)).toEqual(['run-a']);

            const settled = vi.fn<(runId: string) => Promise<boolean>>(async () => true);
            await store.prune(limits, { isSettled: settled });
            expect(settled.mock.calls.map(([runId]) => runId)).toEqual(['run-a']);
            const again = vi.fn<(runId: string) => Promise<boolean>>(async () => true);
            await store.prune(limits, { isSettled: again });
            expect(again).not.toHaveBeenCalled();
            // live notes are not operation records and stay
            expect((await store.findOneNote(scope, 'name'))?.text).toBe('Ada');
            // the active run's record still replays
            expect(await store.applyNote(scope, makeSet('run-b', 'city', 'Rome')))
                .toMatchObject({ kind: 'set', key: 'city' });
        });

        it('copy_in_out', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            const identity = makeIdentity('copy');
            const resolved = await store.resolve(identity);
            identity.chat = 'mutated';
            resolved.identity.chat = 'mutated';
            resolved.generation = 7;
            expect(await store.findOne(makeIdentity('copy'))).toMatchObject({ generation: 0, identity: { chat: 'copy' } });

            await completeTurn(store, clock, scope, 'run-a', 'hello', ['hi']);
            const begun = await store.beginTurn(scope, 'run-b', 'again', LIMITS);
            if (begun.kind !== 'ready') throw new TypeError('expected ready');
            begun.snapshot.messages.push({ role: 'user', content: 'injected' });
            begun.snapshot.itemIds.length = 0;
            begun.snapshot.createdAt.setTime(0);
            const admitted = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(admitted.data.find((item) => item.id === 'user:run-b')?.createdAt).toEqual(clock.now());
            const replay = await store.beginTurn(scope, 'run-b', 'again', LIMITS);
            if (replay.kind !== 'ready') throw new TypeError('expected ready');
            expect(replay.snapshot.messages).toHaveLength(2);
            expect(replay.snapshot.itemIds).toEqual(['user:run-a', 'assistant:run-a:0']);
            expect(replay.snapshot.createdAt).toEqual(clock.now());

            const item = makeEmit(clock, 'run-b', 0, 'original');
            await store.prepareEmit(scope, item);
            item.text = 'mutated';
            item.target!.address = 'mutated';
            const listed = await store.findItems(scope, { limit: 100, offset: 0 });
            const stored = listed.data.find((i) => i.id === 'assistant:run-b:0')!;
            expect(stored).toMatchObject({ text: 'original', target: { address: 'chat-1' } });
            expect(stored.createdAt).toBeInstanceOf(Date);
            stored.text = 'mutated';
            listed.data.length = 0;
            expect((await store.pendingEmits(scope, 'run-b'))[0]?.text).toBe('original');

            const op = makeSet('run-b', 'name', 'Ada');
            const result = await store.applyNote(scope, op);
            op.key = 'other';
            if (result.kind === 'set') result.updatedAt.setTime(0);
            const note = (await store.findOneNote(scope, 'name'))!;
            expect(note.updatedAt).toEqual(clock.now());
            note.text = 'mutated';
            note.source.runId = 'mutated';
            expect(await store.findOneNote(scope, 'name')).toMatchObject({ text: 'Ada', source: { runId: 'run-b' } });
            expect(await store.applyNote(scope, makeSet('run-b', 'name', 'Ada')))
                .toEqual({
                    kind: 'set',
                    key: 'name',
                    updatedAt: clock.now(),
                });
        });

        it('unicode_budget_whole_items', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            // an item may be larger than the history budget: it is skipped whole and counted
            const limits: ResolvedConversationLimits = {
                ...LIMITS,
                maxHistoryBytes: 12,
                maxItemBytes: 64,
            };
            await completeTurn(store, clock, scope, 'run-a', 'ééé', [], limits);
            await completeTurn(store, clock, scope, 'run-b', '😀😀😀😀', [], limits);
            await completeTurn(store, clock, scope, 'run-c', '€€', [], limits);
            const begun = await store.beginTurn(scope, 'run-d', 'next', limits);
            if (begun.kind !== 'ready') throw new TypeError('expected ready');
            expect(begun.snapshot.itemIds).toEqual(['user:run-a', 'user:run-c']);
            expect(begun.snapshot.omitted).toBe(1);
            expect(begun.snapshot.messages).toEqual([
                { role: 'user', content: 'ééé' },
                { role: 'user', content: '€€' },
            ]);
            await store.endTurn(scope, 'run-d', []);

            const one: ResolvedConversationLimits = { ...limits, maxItems: 1 };
            const counted = await store.beginTurn(scope, 'run-e', 'count', one);
            if (counted.kind !== 'ready') throw new TypeError('expected ready');
            expect(counted.snapshot.itemIds).toEqual(['user:run-d']);
            expect(counted.snapshot.omitted).toBe(3);
            await store.endTurn(scope, 'run-e', []);

            await expect(store.beginTurn(scope, 'run-f', 'é'.repeat(33), limits)).rejects.toMatchObject(INVALID);
            expect((await store.findItems(scope, { limit: 100, offset: 0 })).data.some((i) => i.runId === 'run-f'))
                .toBe(false);
            expect((await store.beginTurn(scope, 'run-g', 'free?', limits)).kind).toBe('ready');
        });

        it('selects notes latest updated first within budget and renders them by key', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            const limits: ResolvedConversationLimits = { ...LIMITS, maxNotesBytes: 10 };
            await store.beginTurn(scope, 'run-a', 'hello', limits);
            await store.applyNote(scope, makeSet('run-a', 'b', 'bbbb'));
            clock.advance(1);
            await store.applyNote(scope, makeSet('run-a', 'a', 'aaaa'));
            clock.advance(1);
            await store.applyNote(scope, makeSet('run-a', 'c', 'cccc'));
            await store.endTurn(scope, 'run-a', []);

            const begun = await store.beginTurn(scope, 'run-b', 'question', limits);
            if (begun.kind !== 'ready') throw new TypeError('expected ready');
            expect(begun.snapshot.noteKeys).toEqual(['a', 'c']);
            const [notes, ...rest] = begun.snapshot.messages;
            expect(notes?.role).toBe('user');
            const content = String(notes?.content);
            expect(content).toContain('aaaa');
            expect(content).not.toContain('bbbb');
            expect(content.indexOf('aaaa')).toBeLessThan(content.indexOf('cccc'));
            expect(rest).toEqual([{ role: 'user', content: 'hello' }]);
            expect(begun.snapshot.itemIds).toEqual(['user:run-a']);
        });

        it('no_current_user_duplicate', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await completeTurn(store, clock, scope, 'run-a', 'first', ['r1']);
            const begun = await store.beginTurn(scope, 'run-b', 'second', LIMITS);
            if (begun.kind !== 'ready') throw new TypeError('expected ready');
            expect(begun.snapshot).toMatchObject({
                runId: 'run-b',
                scope,
                omitted: 0,
            });
            expect(begun.snapshot.messages).toEqual([
                { role: 'user', content: 'first' },
                { role: 'assistant', content: 'r1' },
            ]);
            expect(begun.snapshot.itemIds).not.toContain('user:run-b');
            await store.beginTurn(scope, 'run-b', 'second', LIMITS);
            const items = await store.findItems(scope, { limit: 100, offset: 0 });
            expect(items.data.filter((item) => item.id === 'user:run-b')).toHaveLength(1);
            expect(items.data.find((item) => item.id === 'user:run-b')).toMatchObject({
                role: 'user',
                text: 'second',
                runId: 'run-b',
                status: 'sent',
            });
        });

        it('lists items chronologically with paging', async () => {
            const {
                store,
                clock,
                scope,
            } = await setup();
            await completeTurn(store, clock, scope, 'run-a', 'a', ['a1', 'a2']);
            const page = await store.findItems(scope, { limit: 2, offset: 1 });
            expect(page.total).toBe(3);
            expect(page.data.map((item) => item.id)).toEqual(['assistant:run-a:0', 'assistant:run-a:1']);
            await expect(store.findItems(scope, { limit: -1, offset: 0 })).rejects.toMatchObject(INVALID);
        });
    });
}

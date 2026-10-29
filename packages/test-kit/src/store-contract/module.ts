/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidRunStateError, RunNotFoundError, RunStatus } from '@chamvi/core';
import type {
    AgentRevision,
    Artifact,
    Checkpoint,
    Step,
    Stores,
} from '@chamvi/core';
import { ControllableClock } from '../clock/index.ts';
import { makeAgentRevision, makeArtifact, makeRun } from './helpers.ts';

/**
 * Shared behavioural contract for every capability-store bundle.
 *
 * @param create Factory for a fresh, empty store. It MUST use the given clock for all
 *               TTL/expiry decisions (e.g. `(clock) => createMemoryStores({ clock })`).
 */
export function describeStoreContract(
    create: (clock: ControllableClock) => Stores | Promise<Stores>,
): void {
    const setup = async () => {
        const clock = new ControllableClock();
        const store = await create(clock);
        return { clock, stores: store };
    };

    describe('store contract', () => {
        it('claimKey is atomic under concurrency', async () => {
            const { stores: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.idempotency.claimKey('github', 'd1', `run-${i}`, 60_000)),
            );
            expect(results.filter((r) => r.created)).toHaveLength(1);
            const winner = results.find((r) => r.created)!;
            expect(winner.runId).toMatch(/^run-\d+$/);
            expect(results.every((r) => r.runId === winner.runId)).toBe(true);
        });

        it('claimKey expires after ttl', async () => {
            const { stores: store, clock } = await setup();
            const first = await store.idempotency.claimKey('github', 'd1', 'run-1', 1_000);
            expect(first).toEqual({ created: true, runId: 'run-1' });
            expect(await store.idempotency.claimKey('github', 'd1', 'run-2', 1_000)).toEqual({ created: false, runId: 'run-1' });
            clock.advance(1_001);
            expect(await store.idempotency.claimKey('github', 'd1', 'run-2', 1_000)).toEqual({ created: true, runId: 'run-2' });
        });

        it('updateRun enforces expectStatus', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r1'));
            await expect(
                store.runs.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.runs.getRun('r1'))?.status).toBe(RunStatus.QUEUED);
            const updated = await store.runs.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED] });
            expect(updated.status).toBe(RunStatus.RUNNING);
            expect((await store.runs.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
        });

        it('claimRun grants a single owner until expiry', async () => {
            const { stores: store, clock } = await setup();
            await store.runs.createRun(makeRun('r1'));
            expect(await store.runs.claimRun('r1', 'w1', 1_000)).toBe(true);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(false);
            clock.advance(500);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(true);
            expect(await store.runs.renewClaim('r1', 'w2', 1_000)).toBe(false);
            clock.advance(700);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(false);
        });

        it('claimRun can be taken over after expiry', async () => {
            const { stores: store, clock } = await setup();
            await store.runs.createRun(makeRun('r1'));
            expect(await store.runs.claimRun('r1', 'w1', 1_000)).toBe(true);
            clock.advance(1_001);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(true);
            expect((await store.runs.getRun('r1'))?.claim?.owner).toBe('w2');
        });

        it('latestCheckpoint returns highest stepIndex', async () => {
            const { stores: store } = await setup();
            expect(await store.checkpoints.latestCheckpoint('r1')).toBeUndefined();
            await store.runs.createRun(makeRun('r1'));
            await store.runs.createRun(makeRun('r2'));
            const at = new Date(1_000);
            await store.checkpoints.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 2, 
                messages: [], 
                createdAt: at, 
            });
            await store.checkpoints.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 5, 
                messages: [], 
                createdAt: at, 
            });
            await store.checkpoints.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 3, 
                messages: [], 
                createdAt: at, 
            });
            await store.checkpoints.saveCheckpoint({
                runId: 'r2', 
                stepIndex: 9, 
                messages: [], 
                createdAt: at, 
            });
            expect((await store.checkpoints.latestCheckpoint('r1'))?.stepIndex).toBe(5);
        });

        it('saveCheckpoint with an equal stepIndex replaces the latest', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r1'));
            const at = new Date(1_000);
            await store.checkpoints.saveCheckpoint({
                runId: 'r1',
                stepIndex: 2,
                messages: [],
                createdAt: at,
            });
            await store.checkpoints.saveCheckpoint({
                runId: 'r1',
                stepIndex: 2,
                messages: [{ role: 'user', content: 'again' }],
                createdAt: at,
            });
            expect((await store.checkpoints.latestCheckpoint('r1'))?.messages).toEqual([{ role: 'user', content: 'again' }]);
        });

        it('lock acquire is exclusive and released by owner only', async () => {
            const { stores: store } = await setup();
            expect(await store.locks.acquire('k', 'a', 1_000)).toBe(true);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            await store.locks.release('k', 'b');
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            await store.locks.release('k', 'a');
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(true);
        });

        it('effect roundtrip', async () => {
            const { stores: store } = await setup();
            expect(await store.effects.getEffect('e1')).toBeUndefined();
            await store.effects.putEffect('e1', { ok: true });
            expect(await store.effects.getEffect('e1')).toEqual({ result: { ok: true } });
            await store.effects.putEffect('e2', null);
            expect(await store.effects.getEffect('e2')).toEqual({ result: null });
        });

        it('kvList lists one agent\'s keys in code-point order with limit and offset', async () => {
            const { stores: store } = await setup();
            await store.state.kvSet('triage', 'b', 2);
            await store.state.kvSet('triage', 'a-1', { n: 1 });
            await store.state.kvSet('triage', 'B', 'upper');
            await store.state.kvSet('triage', 'a', [1]);
            await store.state.kvSet('other', 'x', true);
            await store.state.kvSet('triage', 'gone', 1);
            await store.state.kvSet('triage', 'gone', undefined);

            expect(await store.state.kvList('triage')).toEqual([
                { key: 'B', value: 'upper' },
                { key: 'a', value: [1] },
                { key: 'a-1', value: { n: 1 } },
                { key: 'b', value: 2 },
            ]);
            expect((await store.state.kvList('triage', { limit: 2, offset: 1 })).map((e) => e.key)).toEqual(['a', 'a-1']);
            expect(await store.state.kvList('triage', { limit: 0 })).toEqual([]);
            expect(await store.state.kvList('nobody')).toEqual([]);

            const [, first] = await store.state.kvList('triage');
            (first!.value as number[]).push(2);
            expect((await store.state.kvList('triage'))[1]!.value).toEqual([1]);
        });

        it('kvList orders an astral key after every BMP key (code points, not UTF-16 units)', async () => {
            const { stores: store } = await setup();
            await store.state.kvSet('triage', '\u{1F600}', 'emoji');
            await store.state.kvSet('triage', '\uFFFD', 'replacement');
            await store.state.kvSet('triage', 'z', 'ascii');
            expect((await store.state.kvList('triage')).map((e) => e.key)).toEqual(['z', '\uFFFD', '\u{1F600}']);
            expect((await store.state.kvList('triage', { offset: 1, limit: 1 })).map((e) => e.key)).toEqual(['\uFFFD']);
        });

        it('kvSet with undefined removes the key', async () => {
            const { stores: store } = await setup();
            await store.state.kvSet('a', 'k', 1);
            await store.state.kvSet('a', 'k', undefined);
            expect(await store.state.kvGet('a', 'k')).toBeUndefined();
            expect(await store.state.kvList('a')).toEqual([]);
        });

        it('state kv and docs roundtrip, docList where filters by top-level equality', async () => {
            const { stores: store } = await setup();
            expect(await store.state.kvGet('a', 'k')).toBeUndefined();
            await store.state.kvSet('a', 'k', { n: 1 });
            expect(await store.state.kvGet('a', 'k')).toEqual({ n: 1 });
            expect(await store.state.kvGet('b', 'k')).toBeUndefined();

            await store.state.docUpsert('a', 'todos', '1', { title: 'x', done: false });
            await store.state.docUpsert('a', 'todos', '2', { title: 'y', done: true });
            await store.state.docUpsert('a', 'todos', '3', { title: 'z', done: true });
            await store.state.docUpsert('b', 'todos', '1', { title: 'other', done: true });

            expect(await store.state.docList('a', 'todos')).toHaveLength(3);
            const done = await store.state.docList('a', 'todos', { where: { done: true } });
            expect(done.map((d) => d.id).sort()).toEqual(['2', '3']);
            expect(await store.state.docList('a', 'todos', { where: { done: true }, limit: 1 })).toHaveLength(1);

            await store.state.docUpsert('a', 'todos', '1', { title: 'x2', done: true });
            expect((await store.state.docList('a', 'todos', { where: { title: 'x2' } })).map((d) => d.id)).toEqual(['1']);
            await store.state.docDelete('a', 'todos', '1');
            expect(await store.state.docList('a', 'todos', { where: { title: 'x2' } })).toEqual([]);
        });

        it('listRuns filters by agent, status, concurrencyKey and returns total', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r3', {
                agent: 'a', 
                status: RunStatus.RUNNING, 
                concurrencyKey: 'k1', 
                createdAt: new Date(3_000), 
            }));
            await store.runs.createRun(makeRun('r1', {
                agent: 'a', 
                status: RunStatus.QUEUED, 
                concurrencyKey: 'k1', 
                createdAt: new Date(1_000), 
            }));
            await store.runs.createRun(makeRun('r2', {
                agent: 'b', 
                status: RunStatus.QUEUED, 
                createdAt: new Date(2_000), 
            }));
            await store.runs.createRun(makeRun('r4', {
                agent: 'a', 
                status: RunStatus.COMPLETED, 
                concurrencyKey: 'k2', 
                createdAt: new Date(4_000), 
            }));

            const all = await store.runs.listRuns({});
            expect(all.total).toBe(4);
            expect(all.data.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);

            expect((await store.runs.listRuns({ agent: 'a' })).data.map((r) => r.id)).toEqual(['r1', 'r3', 'r4']);
            expect((await store.runs.listRuns({ status: [RunStatus.QUEUED, RunStatus.RUNNING] })).total).toBe(3);
            expect((await store.runs.listRuns({ concurrencyKey: 'k1' })).data.map((r) => r.id)).toEqual(['r1', 'r3']);

            const page = await store.runs.listRuns({
                agent: 'a', 
                limit: 1, 
                offset: 1, 
            });
            expect(page.total).toBe(3);
            expect(page.data.map((r) => r.id)).toEqual(['r3']);
        });

        it('listRuns without a limit returns every matching run', async () => {
            const { stores: store } = await setup();
            for (let i = 0; i < 250; i++) {
                await store.runs.createRun(makeRun(`r${String(i).padStart(3, '0')}`, { createdAt: new Date(i) }));
            }

            const all = await store.runs.listRuns({});
            expect(all.total).toBe(250);
            expect(all.data).toHaveLength(250);
            expect((await store.runs.listRuns({ offset: 200 })).data).toHaveLength(50);
        });

        it('claimRun is atomic under concurrency', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r1'));
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.runs.claimRun('r1', `w${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('acquire is atomic under concurrency', async () => {
            const { stores: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.locks.acquire('k', `o${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('lock expires after ttl and can be taken over', async () => {
            const { stores: store, clock } = await setup();
            expect(await store.locks.acquire('k', 'a', 1_000)).toBe(true);
            clock.advance(999);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            clock.advance(1);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(true);
            await store.locks.release('k', 'a');
            expect(await store.locks.acquire('k', 'c', 1_000)).toBe(false);
        });

        it('expiry boundary: exactly at expiresAt counts as expired', async () => {
            const { stores: store, clock } = await setup();
            await store.runs.createRun(makeRun('r1'));
            expect(await store.runs.claimRun('r1', 'w1', 1_000)).toBe(true);
            await store.idempotency.claimKey('s', 'k', 'run-1', 1_000);
            clock.advance(999);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(false);
            expect((await store.idempotency.claimKey('s', 'k', 'run-2', 1_000)).created).toBe(false);
            clock.advance(1);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(true);
            expect((await store.idempotency.claimKey('s', 'k', 'run-2', 1_000)).created).toBe(true);
        });

        it('updateRun on a missing run throws RunNotFoundError', async () => {
            const { stores: store } = await setup();
            await expect(store.runs.updateRun('nope', { status: RunStatus.RUNNING })).rejects.toBeInstanceOf(RunNotFoundError);
        });

        it('claimRun and renewClaim on a missing run return false', async () => {
            const { stores: store } = await setup();
            expect(await store.runs.claimRun('nope', 'w', 1_000)).toBe(false);
            expect(await store.runs.renewClaim('nope', 'w', 1_000)).toBe(false);
        });

        it('updateRun accepts several allowed statuses', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r1', { status: RunStatus.WAITING }));
            const run = await store.runs.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] });
            expect(run.status).toBe(RunStatus.RUNNING);
            await expect(
                store.runs.updateRun('r1', { status: RunStatus.FAILED }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
        });

        it('updateRun enforces expectOwner against the current claim', async () => {
            const { stores: store, clock } = await setup();
            await store.runs.createRun(makeRun('r1', { status: RunStatus.RUNNING }));
            await expect(
                store.runs.updateRun('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect(await store.runs.claimRun('r1', 'w1', 1_000)).toBe(true);
            await expect(
                store.runs.updateRun('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w2' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            clock.advance(1_001);
            expect(await store.runs.claimRun('r1', 'w2', 1_000)).toBe(true);
            await expect(
                store.runs.updateRun('r1', { status: RunStatus.COMPLETED }, { expectStatus: [RunStatus.RUNNING], expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.runs.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
            const updated = await store.runs.updateRun(
                'r1',
                { status: RunStatus.COMPLETED, claim: undefined },
                { expectStatus: [RunStatus.RUNNING], expectOwner: 'w2' },
            );
            expect(updated.status).toBe(RunStatus.COMPLETED);
            expect(updated.claim).toBeUndefined();
        });

        it('updateRun preserves untouched fields and does not clobber claim', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('r1', {
                concurrencyKey: 'k', 
                address: 't', 
                usage: { inputTokens: 3, outputTokens: 4 }, 
            }));
            await store.runs.claimRun('r1', 'w1', 1_000);
            const before = await store.runs.getRun('r1');
            const updated = await store.runs.updateRun('r1', { status: RunStatus.RUNNING });
            expect(updated.claim).toEqual(before?.claim);
            expect(updated.concurrencyKey).toBe('k');
            expect(updated.address).toBe('t');
            expect(updated.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
            expect(updated.agent).toBe('a');
            expect(updated.createdAt).toEqual(before?.createdAt);
            expect((await store.runs.getRun('r1'))?.claim).toEqual(before?.claim);
        });

        it('run.address and trigger.channel round-trip', async () => {
            const { stores: store } = await setup();
            const run = makeRun('r1', { address: 'owner/repo#7' });
            run.trigger = {
                ...run.trigger,
                channel: 'github',
                address: 'owner/repo#7',
            };
            await store.runs.createRun(run);
            const stored = await store.runs.getRun('r1');
            expect(stored?.address).toBe('owner/repo#7');
            expect(stored?.trigger.channel).toBe('github');
            expect(stored?.trigger.address).toBe('owner/repo#7');
            expect(stored?.trigger).not.toHaveProperty('source');
            expect(stored?.trigger).not.toHaveProperty('thread');
            const updated = await store.runs.updateRun('r1', { address: 'owner/repo#8' });
            expect(updated.address).toBe('owner/repo#8');
            const listed = await store.runs.listRuns({});
            expect(listed.data[0]?.address).toBe('owner/repo#8');
            expect(listed.data[0]?.trigger.channel).toBe('github');
        });

        it('trigger.parent round-trips', async () => {
            const { stores: store } = await setup();
            const run = makeRun('r1');
            const parent = {
                kind: 'handoff' as const,
                runId: 'p1',
                agent: 'a',
                depth: 1,
            };
            run.trigger = {
                ...run.trigger, 
                channel: 'agent', 
                parent, 
            };
            await store.runs.createRun(run);
            expect((await store.runs.getRun('r1'))?.trigger.parent).toEqual(parent);
            const listed = await store.runs.listRuns({});
            expect(listed.data[0]?.trigger.parent).toEqual(parent);
        });

        it('an envelope stored before channels (source, thread) reads back as channel and address', async () => {
            const { stores: store } = await setup();
            const run = makeRun('r1');
            run.trigger = {
                id: run.trigger.id,
                agent: run.trigger.agent,
                trigger: run.trigger.trigger,
                payload: run.trigger.payload,
                receivedAt: run.trigger.receivedAt,
                source: 'github',
                thread: 'owner/repo#7',
            } as unknown as typeof run.trigger;
            await store.runs.createRun(run);
            for (const stored of [
                await store.runs.getRun('r1'),
                (await store.runs.listRuns({})).data[0],
                await store.runs.updateRun('r1', { status: RunStatus.RUNNING }),
            ]) {
                expect(stored?.trigger.channel).toBe('github');
                expect(stored?.trigger.address).toBe('owner/repo#7');
                expect(stored?.trigger).not.toHaveProperty('source');
                expect(stored?.trigger).not.toHaveProperty('thread');
            }
        });

        it('listRuns breaks createdAt ties by id ascending', async () => {
            const { stores: store } = await setup();
            for (const id of ['b', 'c', 'a']) {
                await store.runs.createRun(makeRun(id));
            }
            expect((await store.runs.listRuns({})).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
        });

        it('listRuns order desc returns newest first, ties by id descending, and pages from the newest', async () => {
            const { stores: store } = await setup();
            await store.runs.createRun(makeRun('b'));
            await store.runs.createRun(makeRun('a'));
            await store.runs.createRun(makeRun('c', { createdAt: new Date(2_000) }));
            expect((await store.runs.listRuns({ order: 'desc' })).data.map((r) => r.id)).toEqual(['c', 'b', 'a']);
            expect((await store.runs.listRuns({ order: 'asc' })).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
            const page = await store.runs.listRuns({
                order: 'desc',
                limit: 1,
                offset: 1,
            });
            expect(page.data.map((r) => r.id)).toEqual(['b']);
            expect(page.total).toBe(3);
        });

        it('createRun inserts only when the id is absent, also under concurrency', async () => {
            const { stores: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 5 }, (_, i) => store.runs.createRun(makeRun('r1', { address: `t${i}` }))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            const winner = results.indexOf(true);
            expect((await store.runs.getRun('r1'))?.address).toBe(`t${winner}`);
            await store.runs.updateRun('r1', { status: RunStatus.RUNNING });
            expect(await store.runs.createRun(makeRun('r1'))).toBe(false);
            expect((await store.runs.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
            expect((await store.runs.listRuns({})).total).toBe(1);
        });

        it('does not alias values passed in or returned', async () => {
            const { stores: store } = await setup();
            const at = new Date(1_000);

            // run
            const run = makeRun('r1');
            await store.runs.createRun(run);
            run.usage.inputTokens = 99;
            run.trigger.payload = { changed: true };
            const got = (await store.runs.getRun('r1'))!;
            expect(got.usage.inputTokens).toBe(0);
            expect(got.trigger.payload).toEqual({});
            got.usage.inputTokens = 77;
            expect((await store.runs.getRun('r1'))?.usage.inputTokens).toBe(0);
            await store.runs.claimRun('r1', 'w', 1_000);
            const claimed = (await store.runs.getRun('r1'))!;
            claimed.claim!.owner = 'evil';
            expect((await store.runs.getRun('r1'))?.claim?.owner).toBe('w');

            // checkpoint
            const messages = [{ role: 'user', content: 'hi' }] as Checkpoint['messages'];
            await store.checkpoints.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 1, 
                messages, 
                createdAt: at, 
            });
            messages.push({ role: 'user', content: 'later' });
            const cp = (await store.checkpoints.latestCheckpoint('r1'))!;
            expect(cp.messages).toHaveLength(1);
            cp.messages.push({ role: 'user', content: 'x' });
            expect((await store.checkpoints.latestCheckpoint('r1'))?.messages).toHaveLength(1);

            // step
            const step: Step = {
                runId: 'r1', 
                index: 0, 
                kind: 'tool', 
                input: { a: 1 }, 
                startedAt: at, 
                finishedAt: at, 
            };
            await store.steps.appendStep(step);
            (step.input as { a: number }).a = 2;
            const steps = await store.steps.listSteps('r1');
            expect(steps[0]!.input).toEqual({ a: 1 });
            (steps[0]!.input as { a: number }).a = 3;
            expect((await store.steps.listSteps('r1'))[0]!.input).toEqual({ a: 1 });

            // effect
            const result = { list: [1] };
            await store.effects.putEffect('e', result);
            result.list.push(2);
            const effect = (await store.effects.getEffect('e'))!;
            expect(effect.result).toEqual({ list: [1] });
            (effect.result as { list: number[] }).list.push(3);
            expect(await store.effects.getEffect('e')).toEqual({ result: { list: [1] } });

            // doc
            const doc = { n: [1] };
            await store.state.docUpsert('a', 'c', '1', doc);
            doc.n.push(2);
            const docs = await store.state.docList('a', 'c');
            expect(docs[0]!.doc).toEqual({ n: [1] });
            (docs[0]!.doc as { n: number[] }).n.push(3);
            expect((await store.state.docList('a', 'c'))[0]!.doc).toEqual({ n: [1] });

            // kv
            const value = { n: [1] };
            await store.state.kvSet('a', 'k', value);
            value.n.push(2);
            const stored = (await store.state.kvGet('a', 'k')) as { n: number[] };
            expect(stored).toEqual({ n: [1] });
            stored.n.push(3);
            expect(await store.state.kvGet('a', 'k')).toEqual({ n: [1] });
        });

        it('putArtifact inserts only when the id is absent, also under concurrency', async () => {
            const { stores: store } = await setup();
            const first = makeArtifact('a1', { filename: 'first.txt' });
            expect(await store.artifacts.putArtifact(first, new Uint8Array([1, 2, 3]))).toBe(true);
            expect(await store.artifacts.putArtifact(makeArtifact('a1', { filename: 'second.txt', size: 1 }), new Uint8Array([9]))).toBe(false);
            expect(await store.artifacts.getArtifact('a1')).toEqual(first);
            expect(Array.from((await store.artifacts.readArtifact('a1'))!)).toEqual([1, 2, 3]);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) => store.artifacts.putArtifact(makeArtifact('a2', { size: 1 }), new Uint8Array([i]))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            expect((await store.artifacts.listArtifacts('r1')).filter((a) => a.id === 'a2')).toHaveLength(1);
        });

        it('getArtifact and readArtifact return metadata and plain Uint8Array bytes', async () => {
            const { stores: store } = await setup();
            const artifact = makeArtifact('a1', { size: 4 });
            await store.artifacts.putArtifact(artifact, new Uint8Array([0, 255, 10, 13]));
            const got = await store.artifacts.getArtifact('a1');
            expect(got).toEqual(artifact);
            expect(got?.createdAt).toBeInstanceOf(Date);
            expect(got).not.toHaveProperty('data');
            const bytes = await store.artifacts.readArtifact('a1');
            expect(bytes?.constructor).toBe(Uint8Array);
            expect(Array.from(bytes!)).toEqual([0, 255, 10, 13]);

            const empty = makeArtifact('a2', { size: 0, filename: undefined });
            await store.artifacts.putArtifact(empty, new Uint8Array());
            expect((await store.artifacts.readArtifact('a2'))?.byteLength).toBe(0);
            expect((await store.artifacts.getArtifact('a2'))?.filename).toBeUndefined();
        });

        it('artifact reads of unknown ids are empty', async () => {
            const { stores: store } = await setup();
            expect(await store.artifacts.getArtifact('nope')).toBeUndefined();
            expect(await store.artifacts.readArtifact('nope')).toBeUndefined();
            expect(await store.artifacts.listArtifacts('nope')).toEqual([]);
        });

        it('listArtifacts returns the run\'s artifacts by createdAt, then id', async () => {
            const { stores: store } = await setup();
            await store.artifacts.putArtifact(makeArtifact('c', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.artifacts.putArtifact(makeArtifact('b', { createdAt: new Date(1_000) }), new Uint8Array([1]));
            await store.artifacts.putArtifact(makeArtifact('a', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.artifacts.putArtifact(makeArtifact('z', { runId: 'r2', createdAt: new Date(500) }), new Uint8Array([1]));
            const listed = await store.artifacts.listArtifacts('r1');
            expect(listed.map((a) => a.id)).toEqual(['b', 'a', 'c']);
            expect(listed[0]).toEqual(makeArtifact('b', { createdAt: new Date(1_000) }));
            expect((await store.artifacts.listArtifacts('r2')).map((a) => a.id)).toEqual(['z']);
        });

        it('does not alias artifacts passed in or returned', async () => {
            const { stores: store } = await setup();
            const artifact: Artifact = makeArtifact('a1');
            const data = new Uint8Array([1, 2, 3]);
            await store.artifacts.putArtifact(artifact, data);
            data[0] = 9;
            artifact.mediaType = 'text/html';
            artifact.createdAt.setTime(0);
            expect(Array.from((await store.artifacts.readArtifact('a1'))!)).toEqual([1, 2, 3]);
            expect(await store.artifacts.getArtifact('a1')).toEqual(makeArtifact('a1'));

            const read = (await store.artifacts.readArtifact('a1'))!;
            read[1] = 9;
            expect(Array.from((await store.artifacts.readArtifact('a1'))!)).toEqual([1, 2, 3]);
            const got = (await store.artifacts.getArtifact('a1'))!;
            got.size = 99;
            const [listed] = await store.artifacts.listArtifacts('r1');
            listed!.filename = 'evil';
            expect(await store.artifacts.getArtifact('a1')).toEqual(makeArtifact('a1'));
        });

        it('getAgentRevision of an unknown agent is undefined', async () => {
            const { stores: store } = await setup();
            expect(await store.agentRevisions.getAgentRevision('a')).toBeUndefined();
        });

        it('setAgentRevision upserts', async () => {
            const { stores: store } = await setup();
            await store.agentRevisions.setAgentRevision(makeAgentRevision('a'));
            expect(await store.agentRevisions.getAgentRevision('a')).toEqual(makeAgentRevision('a'));
            await store.agentRevisions.setAgentRevision(makeAgentRevision('a', { hash: 'h2', changedAt: new Date(2_000) }));
            expect(await store.agentRevisions.getAgentRevision('a')).toEqual({
                agent: 'a', 
                hash: 'h2', 
                changedAt: new Date(2_000), 
            });
            expect(await store.agentRevisions.listAgentRevisions()).toHaveLength(1);
        });

        it('deleteAgentRevision removes it and ignores a missing one', async () => {
            const { stores: store } = await setup();
            await store.agentRevisions.setAgentRevision(makeAgentRevision('a'));
            await store.agentRevisions.setAgentRevision(makeAgentRevision('b'));
            await store.agentRevisions.deleteAgentRevision('a');
            expect(await store.agentRevisions.getAgentRevision('a')).toBeUndefined();
            await expect(store.agentRevisions.deleteAgentRevision('missing')).resolves.toBeUndefined();
            expect(await store.agentRevisions.listAgentRevisions()).toEqual([makeAgentRevision('b')]);
        });

        it('listAgentRevisions orders by agent code point', async () => {
            const { stores: store } = await setup();
            expect(await store.agentRevisions.listAgentRevisions()).toEqual([]);
            await store.agentRevisions.setAgentRevision(makeAgentRevision('b'));
            await store.agentRevisions.setAgentRevision(makeAgentRevision('a-b'));
            await store.agentRevisions.setAgentRevision(makeAgentRevision('a'));
            expect((await store.agentRevisions.listAgentRevisions()).map((r) => r.agent)).toEqual(['a', 'a-b', 'b']);
        });

        it('agent revisions are copied in and out', async () => {
            const { stores: store } = await setup();
            const revision: AgentRevision = makeAgentRevision('a');
            await store.agentRevisions.setAgentRevision(revision);
            revision.hash = 'evil';
            revision.changedAt.setTime(0);
            expect(await store.agentRevisions.getAgentRevision('a')).toEqual(makeAgentRevision('a'));

            const got = (await store.agentRevisions.getAgentRevision('a'))!;
            expect(got.changedAt).toBeInstanceOf(Date);
            got.hash = 'evil';
            got.changedAt.setTime(0);
            const [listed] = await store.agentRevisions.listAgentRevisions();
            expect(listed!.changedAt).toBeInstanceOf(Date);
            listed!.hash = 'evil';
            listed!.changedAt.setTime(0);
            expect(await store.agentRevisions.getAgentRevision('a')).toEqual(makeAgentRevision('a'));
            expect(await store.agentRevisions.listAgentRevisions()).toEqual([makeAgentRevision('a')]);
        });
    });
}

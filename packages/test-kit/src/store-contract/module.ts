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
    IStore,
    Step,
} from '@chamvi/core';
import { ControllableClock } from '../clock/index.ts';
import { makeAgentRevision, makeArtifact, makeRun } from './helpers.ts';

/**
 * Shared behavioural contract for every IStore implementation.
 *
 * @param create Factory for a fresh, empty store. It MUST use the given clock for all
 *               TTL/expiry decisions (e.g. `(clock) => new MemoryStore({ clock })`).
 */
export function describeStoreContract(
    create: (clock: ControllableClock) => IStore | Promise<IStore>,
): void {
    const setup = async () => {
        const clock = new ControllableClock();
        const store = await create(clock);
        return { clock, store };
    };

    describe('store contract', () => {
        it('claimKey is atomic under concurrency', async () => {
            const { store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.claimKey('github', 'd1', `run-${i}`, 60_000)),
            );
            expect(results.filter((r) => r.created)).toHaveLength(1);
            const winner = results.find((r) => r.created)!;
            expect(winner.runId).toMatch(/^run-\d+$/);
            expect(results.every((r) => r.runId === winner.runId)).toBe(true);
        });

        it('claimKey expires after ttl', async () => {
            const { store, clock } = await setup();
            const first = await store.claimKey('github', 'd1', 'run-1', 1_000);
            expect(first).toEqual({ created: true, runId: 'run-1' });
            expect(await store.claimKey('github', 'd1', 'run-2', 1_000)).toEqual({ created: false, runId: 'run-1' });
            clock.advance(1_001);
            expect(await store.claimKey('github', 'd1', 'run-2', 1_000)).toEqual({ created: true, runId: 'run-2' });
        });

        it('updateRun enforces expectStatus', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('r1'));
            await expect(
                store.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.getRun('r1'))?.status).toBe(RunStatus.QUEUED);
            const updated = await store.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED] });
            expect(updated.status).toBe(RunStatus.RUNNING);
            expect((await store.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
        });

        it('claimRun grants a single owner until expiry', async () => {
            const { store, clock } = await setup();
            await store.createRun(makeRun('r1'));
            expect(await store.claimRun('r1', 'w1', 1_000)).toBe(true);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(false);
            clock.advance(500);
            expect(await store.renewClaim('r1', 'w1', 1_000)).toBe(true);
            expect(await store.renewClaim('r1', 'w2', 1_000)).toBe(false);
            clock.advance(700);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(false);
        });

        it('claimRun can be taken over after expiry', async () => {
            const { store, clock } = await setup();
            await store.createRun(makeRun('r1'));
            expect(await store.claimRun('r1', 'w1', 1_000)).toBe(true);
            clock.advance(1_001);
            expect(await store.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(true);
            expect((await store.getRun('r1'))?.claim?.owner).toBe('w2');
        });

        it('latestCheckpoint returns highest stepIndex', async () => {
            const { store } = await setup();
            expect(await store.latestCheckpoint('r1')).toBeUndefined();
            const at = new Date(1_000);
            await store.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 2, 
                messages: [], 
                createdAt: at, 
            });
            await store.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 5, 
                messages: [], 
                createdAt: at, 
            });
            await store.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 3, 
                messages: [], 
                createdAt: at, 
            });
            await store.saveCheckpoint({
                runId: 'r2', 
                stepIndex: 9, 
                messages: [], 
                createdAt: at, 
            });
            expect((await store.latestCheckpoint('r1'))?.stepIndex).toBe(5);
        });

        it('saveCheckpoint with an equal stepIndex replaces the latest', async () => {
            const { store } = await setup();
            const at = new Date(1_000);
            await store.saveCheckpoint({
                runId: 'r1',
                stepIndex: 2,
                messages: [],
                createdAt: at,
            });
            await store.saveCheckpoint({
                runId: 'r1',
                stepIndex: 2,
                messages: [{ role: 'user', content: 'again' }],
                createdAt: at,
            });
            expect((await store.latestCheckpoint('r1'))?.messages).toEqual([{ role: 'user', content: 'again' }]);
        });

        it('lock acquire is exclusive and released by owner only', async () => {
            const { store } = await setup();
            expect(await store.acquire('k', 'a', 1_000)).toBe(true);
            expect(await store.acquire('k', 'b', 1_000)).toBe(false);
            await store.release('k', 'b');
            expect(await store.acquire('k', 'b', 1_000)).toBe(false);
            await store.release('k', 'a');
            expect(await store.acquire('k', 'b', 1_000)).toBe(true);
        });

        it('effect roundtrip', async () => {
            const { store } = await setup();
            expect(await store.getEffect('e1')).toBeUndefined();
            await store.putEffect('e1', { ok: true });
            expect(await store.getEffect('e1')).toEqual({ result: { ok: true } });
            await store.putEffect('e2', null);
            expect(await store.getEffect('e2')).toEqual({ result: null });
        });

        it('kvList lists one agent\'s keys in code-point order with limit and offset', async () => {
            const { store } = await setup();
            await store.kvSet('triage', 'b', 2);
            await store.kvSet('triage', 'a-1', { n: 1 });
            await store.kvSet('triage', 'B', 'upper');
            await store.kvSet('triage', 'a', [1]);
            await store.kvSet('other', 'x', true);
            await store.kvSet('triage', 'gone', 1);
            await store.kvSet('triage', 'gone', undefined);

            expect(await store.kvList('triage')).toEqual([
                { key: 'B', value: 'upper' },
                { key: 'a', value: [1] },
                { key: 'a-1', value: { n: 1 } },
                { key: 'b', value: 2 },
            ]);
            expect((await store.kvList('triage', { limit: 2, offset: 1 })).map((e) => e.key)).toEqual(['a', 'a-1']);
            expect(await store.kvList('triage', { limit: 0 })).toEqual([]);
            expect(await store.kvList('nobody')).toEqual([]);

            const [, first] = await store.kvList('triage');
            (first!.value as number[]).push(2);
            expect((await store.kvList('triage'))[1]!.value).toEqual([1]);
        });

        it('kvList orders an astral key after every BMP key (code points, not UTF-16 units)', async () => {
            const { store } = await setup();
            await store.kvSet('triage', '\u{1F600}', 'emoji');
            await store.kvSet('triage', '\uFFFD', 'replacement');
            await store.kvSet('triage', 'z', 'ascii');
            expect((await store.kvList('triage')).map((e) => e.key)).toEqual(['z', '\uFFFD', '\u{1F600}']);
            expect((await store.kvList('triage', { offset: 1, limit: 1 })).map((e) => e.key)).toEqual(['\uFFFD']);
        });

        it('kvSet with undefined removes the key', async () => {
            const { store } = await setup();
            await store.kvSet('a', 'k', 1);
            await store.kvSet('a', 'k', undefined);
            expect(await store.kvGet('a', 'k')).toBeUndefined();
            expect(await store.kvList('a')).toEqual([]);
        });

        it('state kv and docs roundtrip, docList where filters by top-level equality', async () => {
            const { store } = await setup();
            expect(await store.kvGet('a', 'k')).toBeUndefined();
            await store.kvSet('a', 'k', { n: 1 });
            expect(await store.kvGet('a', 'k')).toEqual({ n: 1 });
            expect(await store.kvGet('b', 'k')).toBeUndefined();

            await store.docUpsert('a', 'todos', '1', { title: 'x', done: false });
            await store.docUpsert('a', 'todos', '2', { title: 'y', done: true });
            await store.docUpsert('a', 'todos', '3', { title: 'z', done: true });
            await store.docUpsert('b', 'todos', '1', { title: 'other', done: true });

            expect(await store.docList('a', 'todos')).toHaveLength(3);
            const done = await store.docList('a', 'todos', { where: { done: true } });
            expect(done.map((d) => d.id).sort()).toEqual(['2', '3']);
            expect(await store.docList('a', 'todos', { where: { done: true }, limit: 1 })).toHaveLength(1);

            await store.docUpsert('a', 'todos', '1', { title: 'x2', done: true });
            expect((await store.docList('a', 'todos', { where: { title: 'x2' } })).map((d) => d.id)).toEqual(['1']);
            await store.docDelete('a', 'todos', '1');
            expect(await store.docList('a', 'todos', { where: { title: 'x2' } })).toEqual([]);
        });

        it('listRuns filters by agent, status, concurrencyKey and returns total', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('r3', {
                agent: 'a', 
                status: RunStatus.RUNNING, 
                concurrencyKey: 'k1', 
                createdAt: new Date(3_000), 
            }));
            await store.createRun(makeRun('r1', {
                agent: 'a', 
                status: RunStatus.QUEUED, 
                concurrencyKey: 'k1', 
                createdAt: new Date(1_000), 
            }));
            await store.createRun(makeRun('r2', {
                agent: 'b', 
                status: RunStatus.QUEUED, 
                createdAt: new Date(2_000), 
            }));
            await store.createRun(makeRun('r4', {
                agent: 'a', 
                status: RunStatus.COMPLETED, 
                concurrencyKey: 'k2', 
                createdAt: new Date(4_000), 
            }));

            const all = await store.listRuns({});
            expect(all.total).toBe(4);
            expect(all.data.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);

            expect((await store.listRuns({ agent: 'a' })).data.map((r) => r.id)).toEqual(['r1', 'r3', 'r4']);
            expect((await store.listRuns({ status: [RunStatus.QUEUED, RunStatus.RUNNING] })).total).toBe(3);
            expect((await store.listRuns({ concurrencyKey: 'k1' })).data.map((r) => r.id)).toEqual(['r1', 'r3']);

            const page = await store.listRuns({
                agent: 'a', 
                limit: 1, 
                offset: 1, 
            });
            expect(page.total).toBe(3);
            expect(page.data.map((r) => r.id)).toEqual(['r3']);
        });

        it('listRuns without a limit returns every matching run', async () => {
            const { store } = await setup();
            for (let i = 0; i < 250; i++) {
                await store.createRun(makeRun(`r${String(i).padStart(3, '0')}`, { createdAt: new Date(i) }));
            }

            const all = await store.listRuns({});
            expect(all.total).toBe(250);
            expect(all.data).toHaveLength(250);
            expect((await store.listRuns({ offset: 200 })).data).toHaveLength(50);
        });

        it('claimRun is atomic under concurrency', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('r1'));
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.claimRun('r1', `w${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('acquire is atomic under concurrency', async () => {
            const { store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.acquire('k', `o${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('lock expires after ttl and can be taken over', async () => {
            const { store, clock } = await setup();
            expect(await store.acquire('k', 'a', 1_000)).toBe(true);
            clock.advance(999);
            expect(await store.acquire('k', 'b', 1_000)).toBe(false);
            clock.advance(1);
            expect(await store.acquire('k', 'b', 1_000)).toBe(true);
            await store.release('k', 'a');
            expect(await store.acquire('k', 'c', 1_000)).toBe(false);
        });

        it('expiry boundary: exactly at expiresAt counts as expired', async () => {
            const { store, clock } = await setup();
            await store.createRun(makeRun('r1'));
            expect(await store.claimRun('r1', 'w1', 1_000)).toBe(true);
            await store.claimKey('s', 'k', 'run-1', 1_000);
            clock.advance(999);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(false);
            expect((await store.claimKey('s', 'k', 'run-2', 1_000)).created).toBe(false);
            clock.advance(1);
            expect(await store.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(true);
            expect((await store.claimKey('s', 'k', 'run-2', 1_000)).created).toBe(true);
        });

        it('updateRun on a missing run throws RunNotFoundError', async () => {
            const { store } = await setup();
            await expect(store.updateRun('nope', { status: RunStatus.RUNNING })).rejects.toBeInstanceOf(RunNotFoundError);
        });

        it('claimRun and renewClaim on a missing run return false', async () => {
            const { store } = await setup();
            expect(await store.claimRun('nope', 'w', 1_000)).toBe(false);
            expect(await store.renewClaim('nope', 'w', 1_000)).toBe(false);
        });

        it('updateRun accepts several allowed statuses', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('r1', { status: RunStatus.WAITING }));
            const run = await store.updateRun('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] });
            expect(run.status).toBe(RunStatus.RUNNING);
            await expect(
                store.updateRun('r1', { status: RunStatus.FAILED }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
        });

        it('updateRun enforces expectOwner against the current claim', async () => {
            const { store, clock } = await setup();
            await store.createRun(makeRun('r1', { status: RunStatus.RUNNING }));
            await expect(
                store.updateRun('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect(await store.claimRun('r1', 'w1', 1_000)).toBe(true);
            await expect(
                store.updateRun('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w2' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            clock.advance(1_001);
            expect(await store.claimRun('r1', 'w2', 1_000)).toBe(true);
            await expect(
                store.updateRun('r1', { status: RunStatus.COMPLETED }, { expectStatus: [RunStatus.RUNNING], expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
            const updated = await store.updateRun(
                'r1',
                { status: RunStatus.COMPLETED, claim: undefined },
                { expectStatus: [RunStatus.RUNNING], expectOwner: 'w2' },
            );
            expect(updated.status).toBe(RunStatus.COMPLETED);
            expect(updated.claim).toBeUndefined();
        });

        it('updateRun preserves untouched fields and does not clobber claim', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('r1', {
                concurrencyKey: 'k', 
                address: 't', 
                usage: { inputTokens: 3, outputTokens: 4 }, 
            }));
            await store.claimRun('r1', 'w1', 1_000);
            const before = await store.getRun('r1');
            const updated = await store.updateRun('r1', { status: RunStatus.RUNNING });
            expect(updated.claim).toEqual(before?.claim);
            expect(updated.concurrencyKey).toBe('k');
            expect(updated.address).toBe('t');
            expect(updated.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
            expect(updated.agent).toBe('a');
            expect(updated.createdAt).toEqual(before?.createdAt);
            expect((await store.getRun('r1'))?.claim).toEqual(before?.claim);
        });

        it('run.address and trigger.channel round-trip', async () => {
            const { store } = await setup();
            const run = makeRun('r1', { address: 'owner/repo#7' });
            run.trigger = {
                ...run.trigger,
                channel: 'github',
                address: 'owner/repo#7',
            };
            await store.createRun(run);
            const stored = await store.getRun('r1');
            expect(stored?.address).toBe('owner/repo#7');
            expect(stored?.trigger.channel).toBe('github');
            expect(stored?.trigger.address).toBe('owner/repo#7');
            expect(stored?.trigger).not.toHaveProperty('source');
            expect(stored?.trigger).not.toHaveProperty('thread');
            const updated = await store.updateRun('r1', { address: 'owner/repo#8' });
            expect(updated.address).toBe('owner/repo#8');
            const listed = await store.listRuns({});
            expect(listed.data[0]?.address).toBe('owner/repo#8');
            expect(listed.data[0]?.trigger.channel).toBe('github');
        });

        it('trigger.parent round-trips', async () => {
            const { store } = await setup();
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
            await store.createRun(run);
            expect((await store.getRun('r1'))?.trigger.parent).toEqual(parent);
            const listed = await store.listRuns({});
            expect(listed.data[0]?.trigger.parent).toEqual(parent);
        });

        it('an envelope stored before channels (source, thread) reads back as channel and address', async () => {
            const { store } = await setup();
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
            await store.createRun(run);
            for (const stored of [
                await store.getRun('r1'),
                (await store.listRuns({})).data[0],
                await store.updateRun('r1', { status: RunStatus.RUNNING }),
            ]) {
                expect(stored?.trigger.channel).toBe('github');
                expect(stored?.trigger.address).toBe('owner/repo#7');
                expect(stored?.trigger).not.toHaveProperty('source');
                expect(stored?.trigger).not.toHaveProperty('thread');
            }
        });

        it('listRuns breaks createdAt ties by id ascending', async () => {
            const { store } = await setup();
            for (const id of ['b', 'c', 'a']) {
                await store.createRun(makeRun(id));
            }
            expect((await store.listRuns({})).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
        });

        it('listRuns order desc returns newest first, ties by id descending, and pages from the newest', async () => {
            const { store } = await setup();
            await store.createRun(makeRun('b'));
            await store.createRun(makeRun('a'));
            await store.createRun(makeRun('c', { createdAt: new Date(2_000) }));
            expect((await store.listRuns({ order: 'desc' })).data.map((r) => r.id)).toEqual(['c', 'b', 'a']);
            expect((await store.listRuns({ order: 'asc' })).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
            const page = await store.listRuns({
                order: 'desc',
                limit: 1,
                offset: 1,
            });
            expect(page.data.map((r) => r.id)).toEqual(['b']);
            expect(page.total).toBe(3);
        });

        it('createRun inserts only when the id is absent, also under concurrency', async () => {
            const { store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 5 }, (_, i) => store.createRun(makeRun('r1', { address: `t${i}` }))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            const winner = results.indexOf(true);
            expect((await store.getRun('r1'))?.address).toBe(`t${winner}`);
            await store.updateRun('r1', { status: RunStatus.RUNNING });
            expect(await store.createRun(makeRun('r1'))).toBe(false);
            expect((await store.getRun('r1'))?.status).toBe(RunStatus.RUNNING);
            expect((await store.listRuns({})).total).toBe(1);
        });

        it('does not alias values passed in or returned', async () => {
            const { store } = await setup();
            const at = new Date(1_000);

            // run
            const run = makeRun('r1');
            await store.createRun(run);
            run.usage.inputTokens = 99;
            run.trigger.payload = { changed: true };
            const got = (await store.getRun('r1'))!;
            expect(got.usage.inputTokens).toBe(0);
            expect(got.trigger.payload).toEqual({});
            got.usage.inputTokens = 77;
            expect((await store.getRun('r1'))?.usage.inputTokens).toBe(0);
            await store.claimRun('r1', 'w', 1_000);
            const claimed = (await store.getRun('r1'))!;
            claimed.claim!.owner = 'evil';
            expect((await store.getRun('r1'))?.claim?.owner).toBe('w');

            // checkpoint
            const messages = [{ role: 'user', content: 'hi' }] as Checkpoint['messages'];
            await store.saveCheckpoint({
                runId: 'r1', 
                stepIndex: 1, 
                messages, 
                createdAt: at, 
            });
            messages.push({ role: 'user', content: 'later' });
            const cp = (await store.latestCheckpoint('r1'))!;
            expect(cp.messages).toHaveLength(1);
            cp.messages.push({ role: 'user', content: 'x' });
            expect((await store.latestCheckpoint('r1'))?.messages).toHaveLength(1);

            // step
            const step: Step = {
                runId: 'r1', 
                index: 0, 
                kind: 'tool', 
                input: { a: 1 }, 
                startedAt: at, 
                finishedAt: at, 
            };
            await store.appendStep(step);
            (step.input as { a: number }).a = 2;
            const steps = await store.listSteps('r1');
            expect(steps[0]!.input).toEqual({ a: 1 });
            (steps[0]!.input as { a: number }).a = 3;
            expect((await store.listSteps('r1'))[0]!.input).toEqual({ a: 1 });

            // effect
            const result = { list: [1] };
            await store.putEffect('e', result);
            result.list.push(2);
            const effect = (await store.getEffect('e'))!;
            expect(effect.result).toEqual({ list: [1] });
            (effect.result as { list: number[] }).list.push(3);
            expect(await store.getEffect('e')).toEqual({ result: { list: [1] } });

            // doc
            const doc = { n: [1] };
            await store.docUpsert('a', 'c', '1', doc);
            doc.n.push(2);
            const docs = await store.docList('a', 'c');
            expect(docs[0]!.doc).toEqual({ n: [1] });
            (docs[0]!.doc as { n: number[] }).n.push(3);
            expect((await store.docList('a', 'c'))[0]!.doc).toEqual({ n: [1] });

            // kv
            const value = { n: [1] };
            await store.kvSet('a', 'k', value);
            value.n.push(2);
            const stored = (await store.kvGet('a', 'k')) as { n: number[] };
            expect(stored).toEqual({ n: [1] });
            stored.n.push(3);
            expect(await store.kvGet('a', 'k')).toEqual({ n: [1] });
        });

        it('putArtifact inserts only when the id is absent, also under concurrency', async () => {
            const { store } = await setup();
            const first = makeArtifact('a1', { filename: 'first.txt' });
            expect(await store.putArtifact(first, new Uint8Array([1, 2, 3]))).toBe(true);
            expect(await store.putArtifact(makeArtifact('a1', { filename: 'second.txt', size: 1 }), new Uint8Array([9]))).toBe(false);
            expect(await store.getArtifact('a1')).toEqual(first);
            expect(Array.from((await store.readArtifact('a1'))!)).toEqual([1, 2, 3]);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) => store.putArtifact(makeArtifact('a2', { size: 1 }), new Uint8Array([i]))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            expect((await store.listArtifacts('r1')).filter((a) => a.id === 'a2')).toHaveLength(1);
        });

        it('getArtifact and readArtifact return metadata and plain Uint8Array bytes', async () => {
            const { store } = await setup();
            const artifact = makeArtifact('a1', { size: 4 });
            await store.putArtifact(artifact, new Uint8Array([0, 255, 10, 13]));
            const got = await store.getArtifact('a1');
            expect(got).toEqual(artifact);
            expect(got?.createdAt).toBeInstanceOf(Date);
            expect(got).not.toHaveProperty('data');
            const bytes = await store.readArtifact('a1');
            expect(bytes?.constructor).toBe(Uint8Array);
            expect(Array.from(bytes!)).toEqual([0, 255, 10, 13]);

            const empty = makeArtifact('a2', { size: 0, filename: undefined });
            await store.putArtifact(empty, new Uint8Array());
            expect((await store.readArtifact('a2'))?.byteLength).toBe(0);
            expect((await store.getArtifact('a2'))?.filename).toBeUndefined();
        });

        it('artifact reads of unknown ids are empty', async () => {
            const { store } = await setup();
            expect(await store.getArtifact('nope')).toBeUndefined();
            expect(await store.readArtifact('nope')).toBeUndefined();
            expect(await store.listArtifacts('nope')).toEqual([]);
        });

        it('listArtifacts returns the run\'s artifacts by createdAt, then id', async () => {
            const { store } = await setup();
            await store.putArtifact(makeArtifact('c', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.putArtifact(makeArtifact('b', { createdAt: new Date(1_000) }), new Uint8Array([1]));
            await store.putArtifact(makeArtifact('a', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.putArtifact(makeArtifact('z', { runId: 'r2', createdAt: new Date(500) }), new Uint8Array([1]));
            const listed = await store.listArtifacts('r1');
            expect(listed.map((a) => a.id)).toEqual(['b', 'a', 'c']);
            expect(listed[0]).toEqual(makeArtifact('b', { createdAt: new Date(1_000) }));
            expect((await store.listArtifacts('r2')).map((a) => a.id)).toEqual(['z']);
        });

        it('does not alias artifacts passed in or returned', async () => {
            const { store } = await setup();
            const artifact: Artifact = makeArtifact('a1');
            const data = new Uint8Array([1, 2, 3]);
            await store.putArtifact(artifact, data);
            data[0] = 9;
            artifact.mediaType = 'text/html';
            artifact.createdAt.setTime(0);
            expect(Array.from((await store.readArtifact('a1'))!)).toEqual([1, 2, 3]);
            expect(await store.getArtifact('a1')).toEqual(makeArtifact('a1'));

            const read = (await store.readArtifact('a1'))!;
            read[1] = 9;
            expect(Array.from((await store.readArtifact('a1'))!)).toEqual([1, 2, 3]);
            const got = (await store.getArtifact('a1'))!;
            got.size = 99;
            const [listed] = await store.listArtifacts('r1');
            listed!.filename = 'evil';
            expect(await store.getArtifact('a1')).toEqual(makeArtifact('a1'));
        });

        it('getAgentRevision of an unknown agent is undefined', async () => {
            const { store } = await setup();
            expect(await store.getAgentRevision('a')).toBeUndefined();
        });

        it('setAgentRevision upserts', async () => {
            const { store } = await setup();
            await store.setAgentRevision(makeAgentRevision('a'));
            expect(await store.getAgentRevision('a')).toEqual(makeAgentRevision('a'));
            await store.setAgentRevision(makeAgentRevision('a', { hash: 'h2', changedAt: new Date(2_000) }));
            expect(await store.getAgentRevision('a')).toEqual({
                agent: 'a', 
                hash: 'h2', 
                changedAt: new Date(2_000), 
            });
            expect(await store.listAgentRevisions()).toHaveLength(1);
        });

        it('deleteAgentRevision removes it and ignores a missing one', async () => {
            const { store } = await setup();
            await store.setAgentRevision(makeAgentRevision('a'));
            await store.setAgentRevision(makeAgentRevision('b'));
            await store.deleteAgentRevision('a');
            expect(await store.getAgentRevision('a')).toBeUndefined();
            await expect(store.deleteAgentRevision('missing')).resolves.toBeUndefined();
            expect(await store.listAgentRevisions()).toEqual([makeAgentRevision('b')]);
        });

        it('listAgentRevisions orders by agent code point', async () => {
            const { store } = await setup();
            expect(await store.listAgentRevisions()).toEqual([]);
            await store.setAgentRevision(makeAgentRevision('b'));
            await store.setAgentRevision(makeAgentRevision('a-b'));
            await store.setAgentRevision(makeAgentRevision('a'));
            expect((await store.listAgentRevisions()).map((r) => r.agent)).toEqual(['a', 'a-b', 'b']);
        });

        it('agent revisions are copied in and out', async () => {
            const { store } = await setup();
            const revision: AgentRevision = makeAgentRevision('a');
            await store.setAgentRevision(revision);
            revision.hash = 'evil';
            revision.changedAt.setTime(0);
            expect(await store.getAgentRevision('a')).toEqual(makeAgentRevision('a'));

            const got = (await store.getAgentRevision('a'))!;
            expect(got.changedAt).toBeInstanceOf(Date);
            got.hash = 'evil';
            got.changedAt.setTime(0);
            const [listed] = await store.listAgentRevisions();
            expect(listed!.changedAt).toBeInstanceOf(Date);
            listed!.hash = 'evil';
            listed!.changedAt.setTime(0);
            expect(await store.getAgentRevision('a')).toEqual(makeAgentRevision('a'));
            expect(await store.listAgentRevisions()).toEqual([makeAgentRevision('a')]);
        });
    });
}

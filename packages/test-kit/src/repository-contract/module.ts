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
    Repositories,
    Step,
} from '@chamvi/core';
import { ControllableClock } from '../clock/index.ts';
import { makeAgentRevision, makeArtifact, makeRun } from './helpers.ts';

/**
 * Shared behavioural contract for every repository bundle.
 *
 * @param create Factory for a fresh, empty repository bundle. It MUST use the given clock for all
 *               TTL/expiry decisions (e.g. `(clock) => createMemoryRepositories({ clock })`).
 */
export function describeRepositoryContract(
    create: (clock: ControllableClock) => Repositories | Promise<Repositories>,
): void {
    const setup = async () => {
        const clock = new ControllableClock();
        const store = await create(clock);
        return { clock, repositories: store };
    };

    describe('repository contract', () => {
        it('findOneOrFail rejects missing identities without creating them', async () => {
            const { repositories } = await setup();
            await expect(repositories.runs.findOneOrFail('missing')).rejects.toMatchObject({ code: 'run_not_found' });
            await expect(repositories.artifacts.findOneOrFail('missing')).rejects.toMatchObject({ code: 'artifact_not_found' });
            await expect(repositories.checkpoints.findOneOrFail('missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.effects.findOneOrFail('missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.agentRevisions.findOneOrFail('missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.state.findOneOrFail('a', 'missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            expect(await repositories.runs.find({})).toEqual({ data: [], total: 0 });
            expect(await repositories.state.find('a')).toEqual([]);
        });

        it('findOrFail rejects empty collections and pages even when total is nonzero', async () => {
            const { repositories } = await setup();
            await expect(repositories.runs.findOrFail({})).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.steps.findOrFail('missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.artifacts.findOrFail('missing')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.agentRevisions.findOrFail()).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.state.findOrFail('a')).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.state.findDocumentsOrFail('a', 'notes')).rejects.toMatchObject({ code: 'repository_not_found' });
            await repositories.runs.insert(makeRun('r1'));
            await expect(repositories.runs.findOrFail({ limit: 0 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await expect(repositories.runs.findOrFail({ offset: 1 })).rejects.toMatchObject({ code: 'repository_not_found' });
            expect(await repositories.runs.find({ offset: 1 })).toEqual({ data: [], total: 1 });
            await repositories.state.set('a', 'key', 'value');
            await expect(repositories.state.findOrFail('a', { offset: 1 })).rejects.toMatchObject({ code: 'repository_not_found' });
            await repositories.state.upsertDocument('a', 'notes', '1', { title: 'first' });
            await expect(repositories.state.findDocumentsOrFail('a', 'notes', { where: { title: 'absent' } })).rejects.toMatchObject({ code: 'repository_not_found' });
        });

        it('OrFail queries preserve ordered results, latest checkpoints and copies', async () => {
            const { repositories } = await setup();
            const run = makeRun('r1');
            await repositories.runs.insert(run);
            await repositories.runs.insert(makeRun('r2', { createdAt: new Date(2_000) }));
            const found = await repositories.runs.findOneOrFail('r1');
            found.trigger.payload = { changed: true };
            expect(await repositories.runs.findOneOrFail('r1')).toEqual(run);
            expect((await repositories.runs.findOrFail({ order: 'desc', limit: 1 })).data.map((row) => row.id)).toEqual(['r2']);
            const checkpoint = {
                runId: 'r1',
                stepIndex: 2,
                messages: [],
                createdAt: new Date(1_000),
            };
            await repositories.checkpoints.save(checkpoint);
            await repositories.checkpoints.save({ ...checkpoint, stepIndex: 1 });
            expect(await repositories.checkpoints.findOneOrFail('r1')).toEqual(checkpoint);
            const artifact = makeArtifact('a1');
            await repositories.artifacts.insert(artifact, new Uint8Array([1, 2, 3]));
            expect(await repositories.artifacts.findOneOrFail('a1')).toEqual(artifact);
            expect(await repositories.artifacts.findOrFail('r1')).toEqual([artifact]);
            const revision = makeAgentRevision('a');
            await repositories.agentRevisions.save(revision);
            expect(await repositories.agentRevisions.findOneOrFail('a')).toEqual(revision);
            expect(await repositories.agentRevisions.findOrFail()).toEqual([revision]);
            const step: Step = {
                runId: 'r1',
                index: 0,
                kind: 'llm',
                output: 'hello',
                startedAt: new Date(1_000),
                finishedAt: new Date(1_001),
            };
            await repositories.steps.insert(step);
            expect(await repositories.steps.findOrFail('r1')).toEqual([step]);
        });

        it('findOneOrFail treats falsy stored values as present and preserves scope', async () => {
            const { repositories } = await setup();
            for (const value of [null, false, 0, '']) {
                await repositories.state.set('a', 'key', value);
                expect(await repositories.state.findOneOrFail('a', 'key')).toEqual(value);
                await repositories.effects.save('effect', value);
                expect(await repositories.effects.findOneOrFail('effect')).toEqual({ result: value });
            }
            await expect(repositories.state.findOneOrFail('b', 'key')).rejects.toMatchObject({ code: 'repository_not_found' });
            expect(await repositories.state.findOrFail('a')).toEqual([{ key: 'key', value: '' }]);
            await repositories.state.upsertDocument('a', 'notes', '1', { title: 'first' });
            const docs = await repositories.state.findDocumentsOrFail('a', 'notes', { where: { title: 'first' } });
            expect(docs).toEqual([{ id: '1', doc: { title: 'first' } }]);
            docs[0]!.doc = { changed: true };
            expect(await repositories.state.findDocumentsOrFail('a', 'notes')).toEqual([{ id: '1', doc: { title: 'first' } }]);
            await repositories.state.set('a', 'key', undefined);
            await expect(repositories.state.findOneOrFail('a', 'key')).rejects.toMatchObject({ code: 'repository_not_found' });
        });

        it('idempotency.claim is atomic under concurrency', async () => {
            const { repositories: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.idempotency.claim('github', 'd1', `run-${i}`, 60_000)),
            );
            expect(results.filter((r) => r.created)).toHaveLength(1);
            const winner = results.find((r) => r.created)!;
            expect(winner.runId).toMatch(/^run-\d+$/);
            expect(results.every((r) => r.runId === winner.runId)).toBe(true);
        });

        it('idempotency.claim expires after ttl', async () => {
            const { repositories: store, clock } = await setup();
            const first = await store.idempotency.claim('github', 'd1', 'run-1', 1_000);
            expect(first).toEqual({ created: true, runId: 'run-1' });
            expect(await store.idempotency.claim('github', 'd1', 'run-2', 1_000)).toEqual({ created: false, runId: 'run-1' });
            clock.advance(1_001);
            expect(await store.idempotency.claim('github', 'd1', 'run-2', 1_000)).toEqual({ created: true, runId: 'run-2' });
        });

        it('runs.update enforces expectStatus', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r1'));
            await expect(
                store.runs.update('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.runs.findOne('r1'))?.status).toBe(RunStatus.QUEUED);
            const updated = await store.runs.update('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED] });
            expect(updated.status).toBe(RunStatus.RUNNING);
            expect((await store.runs.findOne('r1'))?.status).toBe(RunStatus.RUNNING);
        });

        it('runs.claim grants a single owner until expiry', async () => {
            const { repositories: store, clock } = await setup();
            await store.runs.insert(makeRun('r1'));
            expect(await store.runs.claim('r1', 'w1', 1_000)).toBe(true);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(false);
            clock.advance(500);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(true);
            expect(await store.runs.renewClaim('r1', 'w2', 1_000)).toBe(false);
            clock.advance(700);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(false);
        });

        it('runs.claim can be taken over after expiry', async () => {
            const { repositories: store, clock } = await setup();
            await store.runs.insert(makeRun('r1'));
            expect(await store.runs.claim('r1', 'w1', 1_000)).toBe(true);
            clock.advance(1_001);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(true);
            expect((await store.runs.findOne('r1'))?.claim?.owner).toBe('w2');
        });

        it('checkpoints.findOne returns highest stepIndex', async () => {
            const { repositories: store } = await setup();
            expect(await store.checkpoints.findOne('r1')).toBeUndefined();
            await store.runs.insert(makeRun('r1'));
            await store.runs.insert(makeRun('r2'));
            const at = new Date(1_000);
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 2,
                messages: [],
                createdAt: at,
            });
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 5,
                messages: [],
                createdAt: at,
            });
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 3,
                messages: [],
                createdAt: at,
            });
            await store.checkpoints.save({
                runId: 'r2',
                stepIndex: 9,
                messages: [],
                createdAt: at,
            });
            expect((await store.checkpoints.findOne('r1'))?.stepIndex).toBe(5);
        });

        it('checkpoints.save with an equal stepIndex replaces the latest', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r1'));
            const at = new Date(1_000);
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 2,
                messages: [],
                createdAt: at,
            });
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 2,
                messages: [{ role: 'user', content: 'again' }],
                createdAt: at,
            });
            expect((await store.checkpoints.findOne('r1'))?.messages).toEqual([{ role: 'user', content: 'again' }]);
        });

        it('lock acquire is exclusive and released by owner only', async () => {
            const { repositories: store } = await setup();
            expect(await store.locks.acquire('k', 'a', 1_000)).toBe(true);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            await store.locks.release('k', 'b');
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            await store.locks.release('k', 'a');
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(true);
        });

        it('effect roundtrip', async () => {
            const { repositories: store } = await setup();
            expect(await store.effects.findOne('e1')).toBeUndefined();
            await store.effects.save('e1', { ok: true });
            expect(await store.effects.findOne('e1')).toEqual({ result: { ok: true } });
            await store.effects.save('e2', null);
            expect(await store.effects.findOne('e2')).toEqual({ result: null });
        });

        it('state.find lists one agent\'s keys in code-point order with limit and offset', async () => {
            const { repositories: store } = await setup();
            await store.state.set('triage', 'b', 2);
            await store.state.set('triage', 'a-1', { n: 1 });
            await store.state.set('triage', 'B', 'upper');
            await store.state.set('triage', 'a', [1]);
            await store.state.set('other', 'x', true);
            await store.state.set('triage', 'gone', 1);
            await store.state.set('triage', 'gone', undefined);

            expect(await store.state.find('triage')).toEqual([
                { key: 'B', value: 'upper' },
                { key: 'a', value: [1] },
                { key: 'a-1', value: { n: 1 } },
                { key: 'b', value: 2 },
            ]);
            expect((await store.state.find('triage', { limit: 2, offset: 1 })).map((e) => e.key)).toEqual(['a', 'a-1']);
            expect(await store.state.find('triage', { limit: 0 })).toEqual([]);
            expect(await store.state.find('nobody')).toEqual([]);

            const [, first] = await store.state.find('triage');
            (first!.value as number[]).push(2);
            expect((await store.state.find('triage'))[1]!.value).toEqual([1]);
        });

        it('state.find orders an astral key after every BMP key (code points, not UTF-16 units)', async () => {
            const { repositories: store } = await setup();
            await store.state.set('triage', '\u{1F600}', 'emoji');
            await store.state.set('triage', '\uFFFD', 'replacement');
            await store.state.set('triage', 'z', 'ascii');
            expect((await store.state.find('triage')).map((e) => e.key)).toEqual(['z', '\uFFFD', '\u{1F600}']);
            expect((await store.state.find('triage', { offset: 1, limit: 1 })).map((e) => e.key)).toEqual(['\uFFFD']);
        });

        it('state.set with undefined removes the key', async () => {
            const { repositories: store } = await setup();
            await store.state.set('a', 'k', 1);
            await store.state.set('a', 'k', undefined);
            expect(await store.state.findOne('a', 'k')).toBeUndefined();
            expect(await store.state.find('a')).toEqual([]);
        });

        it('state kv and docs roundtrip, state.findDocuments where filters by top-level equality', async () => {
            const { repositories: store } = await setup();
            expect(await store.state.findOne('a', 'k')).toBeUndefined();
            await store.state.set('a', 'k', { n: 1 });
            expect(await store.state.findOne('a', 'k')).toEqual({ n: 1 });
            expect(await store.state.findOne('b', 'k')).toBeUndefined();

            await store.state.upsertDocument('a', 'todos', '1', { title: 'x', done: false });
            await store.state.upsertDocument('a', 'todos', '2', { title: 'y', done: true });
            await store.state.upsertDocument('a', 'todos', '3', { title: 'z', done: true });
            await store.state.upsertDocument('b', 'todos', '1', { title: 'other', done: true });

            expect(await store.state.findDocuments('a', 'todos')).toHaveLength(3);
            const done = await store.state.findDocuments('a', 'todos', { where: { done: true } });
            expect(done.map((d) => d.id).sort()).toEqual(['2', '3']);
            expect(await store.state.findDocuments('a', 'todos', { where: { done: true }, limit: 1 })).toHaveLength(1);

            await store.state.upsertDocument('a', 'todos', '1', { title: 'x2', done: true });
            expect((await store.state.findDocuments('a', 'todos', { where: { title: 'x2' } })).map((d) => d.id)).toEqual(['1']);
            await store.state.deleteDocument('a', 'todos', '1');
            expect(await store.state.findDocuments('a', 'todos', { where: { title: 'x2' } })).toEqual([]);
        });

        it('runs.find filters by agent, status, concurrencyKey and returns total', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r3', {
                agent: 'a',
                status: RunStatus.RUNNING,
                concurrencyKey: 'k1',
                createdAt: new Date(3_000),
            }));
            await store.runs.insert(makeRun('r1', {
                agent: 'a',
                status: RunStatus.QUEUED,
                concurrencyKey: 'k1',
                createdAt: new Date(1_000),
            }));
            await store.runs.insert(makeRun('r2', {
                agent: 'b',
                status: RunStatus.QUEUED,
                createdAt: new Date(2_000),
            }));
            await store.runs.insert(makeRun('r4', {
                agent: 'a',
                status: RunStatus.COMPLETED,
                concurrencyKey: 'k2',
                createdAt: new Date(4_000),
            }));

            const all = await store.runs.find({});
            expect(all.total).toBe(4);
            expect(all.data.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);

            expect((await store.runs.find({ agent: 'a' })).data.map((r) => r.id)).toEqual(['r1', 'r3', 'r4']);
            expect((await store.runs.find({ status: [RunStatus.QUEUED, RunStatus.RUNNING] })).total).toBe(3);
            expect((await store.runs.find({ concurrencyKey: 'k1' })).data.map((r) => r.id)).toEqual(['r1', 'r3']);

            const page = await store.runs.find({
                agent: 'a',
                limit: 1,
                offset: 1,
            });
            expect(page.total).toBe(3);
            expect(page.data.map((r) => r.id)).toEqual(['r3']);
        });

        it('runs.find without a limit returns every matching run', async () => {
            const { repositories: store } = await setup();
            for (let i = 0; i < 250; i++) {
                await store.runs.insert(makeRun(`r${String(i).padStart(3, '0')}`, { createdAt: new Date(i) }));
            }

            const all = await store.runs.find({});
            expect(all.total).toBe(250);
            expect(all.data).toHaveLength(250);
            expect((await store.runs.find({ offset: 200 })).data).toHaveLength(50);
        });

        it('runs.claim is atomic under concurrency', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r1'));
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.runs.claim('r1', `w${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('acquire is atomic under concurrency', async () => {
            const { repositories: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 20 }, (_, i) => store.locks.acquire('k', `o${i}`, 1_000)),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
        });

        it('lock expires after ttl and can be taken over', async () => {
            const { repositories: store, clock } = await setup();
            expect(await store.locks.acquire('k', 'a', 1_000)).toBe(true);
            clock.advance(999);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(false);
            clock.advance(1);
            expect(await store.locks.acquire('k', 'b', 1_000)).toBe(true);
            await store.locks.release('k', 'a');
            expect(await store.locks.acquire('k', 'c', 1_000)).toBe(false);
        });

        it('expiry boundary: exactly at expiresAt counts as expired', async () => {
            const { repositories: store, clock } = await setup();
            await store.runs.insert(makeRun('r1'));
            expect(await store.runs.claim('r1', 'w1', 1_000)).toBe(true);
            await store.idempotency.claim('s', 'k', 'run-1', 1_000);
            clock.advance(999);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(false);
            expect((await store.idempotency.claim('s', 'k', 'run-2', 1_000)).created).toBe(false);
            clock.advance(1);
            expect(await store.runs.renewClaim('r1', 'w1', 1_000)).toBe(false);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(true);
            expect((await store.idempotency.claim('s', 'k', 'run-2', 1_000)).created).toBe(true);
        });

        it('runs.update on a missing run throws RunNotFoundError', async () => {
            const { repositories: store } = await setup();
            await expect(store.runs.update('nope', { status: RunStatus.RUNNING })).rejects.toBeInstanceOf(RunNotFoundError);
        });

        it('runs.claim and renewClaim on a missing run return false', async () => {
            const { repositories: store } = await setup();
            expect(await store.runs.claim('nope', 'w', 1_000)).toBe(false);
            expect(await store.runs.renewClaim('nope', 'w', 1_000)).toBe(false);
        });

        it('runs.update accepts several allowed statuses', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r1', { status: RunStatus.WAITING }));
            const run = await store.runs.update('r1', { status: RunStatus.RUNNING }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] });
            expect(run.status).toBe(RunStatus.RUNNING);
            await expect(
                store.runs.update('r1', { status: RunStatus.FAILED }, { expectStatus: [RunStatus.QUEUED, RunStatus.WAITING] }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
        });

        it('runs.update enforces expectOwner against the current claim', async () => {
            const { repositories: store, clock } = await setup();
            await store.runs.insert(makeRun('r1', { status: RunStatus.RUNNING }));
            await expect(
                store.runs.update('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect(await store.runs.claim('r1', 'w1', 1_000)).toBe(true);
            await expect(
                store.runs.update('r1', { status: RunStatus.COMPLETED }, { expectOwner: 'w2' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            clock.advance(1_001);
            expect(await store.runs.claim('r1', 'w2', 1_000)).toBe(true);
            await expect(
                store.runs.update('r1', { status: RunStatus.COMPLETED }, { expectStatus: [RunStatus.RUNNING], expectOwner: 'w1' }),
            ).rejects.toBeInstanceOf(InvalidRunStateError);
            expect((await store.runs.findOne('r1'))?.status).toBe(RunStatus.RUNNING);
            const updated = await store.runs.update(
                'r1',
                { status: RunStatus.COMPLETED, claim: undefined },
                { expectStatus: [RunStatus.RUNNING], expectOwner: 'w2' },
            );
            expect(updated.status).toBe(RunStatus.COMPLETED);
            expect(updated.claim).toBeUndefined();
        });

        it('runs.update preserves untouched fields and does not clobber claim', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('r1', {
                concurrencyKey: 'k',
                address: 't',
                usage: { inputTokens: 3, outputTokens: 4 },
            }));
            await store.runs.claim('r1', 'w1', 1_000);
            const before = await store.runs.findOne('r1');
            const updated = await store.runs.update('r1', { status: RunStatus.RUNNING });
            expect(updated.claim).toEqual(before?.claim);
            expect(updated.concurrencyKey).toBe('k');
            expect(updated.address).toBe('t');
            expect(updated.usage).toEqual({ inputTokens: 3, outputTokens: 4 });
            expect(updated.agent).toBe('a');
            expect(updated.createdAt).toEqual(before?.createdAt);
            expect((await store.runs.findOne('r1'))?.claim).toEqual(before?.claim);
        });

        it('run.address and trigger.channel round-trip', async () => {
            const { repositories: store } = await setup();
            const run = makeRun('r1', { address: 'owner/repo#7' });
            run.trigger = {
                ...run.trigger,
                channel: 'github',
                address: 'owner/repo#7',
            };
            await store.runs.insert(run);
            const stored = await store.runs.findOne('r1');
            expect(stored?.address).toBe('owner/repo#7');
            expect(stored?.trigger.channel).toBe('github');
            expect(stored?.trigger.address).toBe('owner/repo#7');
            expect(stored?.trigger).not.toHaveProperty('source');
            expect(stored?.trigger).not.toHaveProperty('thread');
            const updated = await store.runs.update('r1', { address: 'owner/repo#8' });
            expect(updated.address).toBe('owner/repo#8');
            const listed = await store.runs.find({});
            expect(listed.data[0]?.address).toBe('owner/repo#8');
            expect(listed.data[0]?.trigger.channel).toBe('github');
        });

        it('trigger.parent round-trips', async () => {
            const { repositories: store } = await setup();
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
            await store.runs.insert(run);
            expect((await store.runs.findOne('r1'))?.trigger.parent).toEqual(parent);
            const listed = await store.runs.find({});
            expect(listed.data[0]?.trigger.parent).toEqual(parent);
        });

        it('an envelope stored before channels (source, thread) reads back as channel and address', async () => {
            const { repositories: store } = await setup();
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
            await store.runs.insert(run);
            for (const stored of [
                await store.runs.findOne('r1'),
                (await store.runs.find({})).data[0],
                await store.runs.update('r1', { status: RunStatus.RUNNING }),
            ]) {
                expect(stored?.trigger.channel).toBe('github');
                expect(stored?.trigger.address).toBe('owner/repo#7');
                expect(stored?.trigger).not.toHaveProperty('source');
                expect(stored?.trigger).not.toHaveProperty('thread');
            }
        });

        it('runs.find breaks createdAt ties by id ascending', async () => {
            const { repositories: store } = await setup();
            for (const id of ['b', 'c', 'a']) {
                await store.runs.insert(makeRun(id));
            }
            expect((await store.runs.find({})).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
        });

        it('runs.find order desc returns newest first, ties by id descending, and pages from the newest', async () => {
            const { repositories: store } = await setup();
            await store.runs.insert(makeRun('b'));
            await store.runs.insert(makeRun('a'));
            await store.runs.insert(makeRun('c', { createdAt: new Date(2_000) }));
            expect((await store.runs.find({ order: 'desc' })).data.map((r) => r.id)).toEqual(['c', 'b', 'a']);
            expect((await store.runs.find({ order: 'asc' })).data.map((r) => r.id)).toEqual(['a', 'b', 'c']);
            const page = await store.runs.find({
                order: 'desc',
                limit: 1,
                offset: 1,
            });
            expect(page.data.map((r) => r.id)).toEqual(['b']);
            expect(page.total).toBe(3);
        });

        it('runs.insert inserts only when the id is absent, also under concurrency', async () => {
            const { repositories: store } = await setup();
            const results = await Promise.all(
                Array.from({ length: 5 }, (_, i) => store.runs.insert(makeRun('r1', { address: `t${i}` }))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            const winner = results.indexOf(true);
            expect((await store.runs.findOne('r1'))?.address).toBe(`t${winner}`);
            await store.runs.update('r1', { status: RunStatus.RUNNING });
            expect(await store.runs.insert(makeRun('r1'))).toBe(false);
            expect((await store.runs.findOne('r1'))?.status).toBe(RunStatus.RUNNING);
            expect((await store.runs.find({})).total).toBe(1);
        });

        it('does not alias values passed in or returned', async () => {
            const { repositories: store } = await setup();
            const at = new Date(1_000);

            // run
            const run = makeRun('r1');
            await store.runs.insert(run);
            run.usage.inputTokens = 99;
            run.trigger.payload = { changed: true };
            const got = (await store.runs.findOne('r1'))!;
            expect(got.usage.inputTokens).toBe(0);
            expect(got.trigger.payload).toEqual({});
            got.usage.inputTokens = 77;
            expect((await store.runs.findOne('r1'))?.usage.inputTokens).toBe(0);
            await store.runs.claim('r1', 'w', 1_000);
            const claimed = (await store.runs.findOne('r1'))!;
            claimed.claim!.owner = 'evil';
            expect((await store.runs.findOne('r1'))?.claim?.owner).toBe('w');

            // checkpoint
            const messages = [{ role: 'user', content: 'hi' }] as Checkpoint['messages'];
            await store.checkpoints.save({
                runId: 'r1',
                stepIndex: 1,
                messages,
                createdAt: at,
            });
            messages.push({ role: 'user', content: 'later' });
            const cp = (await store.checkpoints.findOne('r1'))!;
            expect(cp.messages).toHaveLength(1);
            cp.messages.push({ role: 'user', content: 'x' });
            expect((await store.checkpoints.findOne('r1'))?.messages).toHaveLength(1);

            // step
            const step: Step = {
                runId: 'r1',
                index: 0,
                kind: 'tool',
                input: { a: 1 },
                startedAt: at,
                finishedAt: at,
            };
            await store.steps.insert(step);
            (step.input as { a: number }).a = 2;
            const steps = await store.steps.find('r1');
            expect(steps[0]!.input).toEqual({ a: 1 });
            (steps[0]!.input as { a: number }).a = 3;
            expect((await store.steps.find('r1'))[0]!.input).toEqual({ a: 1 });

            // effect
            const result = { list: [1] };
            await store.effects.save('e', result);
            result.list.push(2);
            const effect = (await store.effects.findOne('e'))!;
            expect(effect.result).toEqual({ list: [1] });
            (effect.result as { list: number[] }).list.push(3);
            expect(await store.effects.findOne('e')).toEqual({ result: { list: [1] } });

            // doc
            const doc = { n: [1] };
            await store.state.upsertDocument('a', 'c', '1', doc);
            doc.n.push(2);
            const docs = await store.state.findDocuments('a', 'c');
            expect(docs[0]!.doc).toEqual({ n: [1] });
            (docs[0]!.doc as { n: number[] }).n.push(3);
            expect((await store.state.findDocuments('a', 'c'))[0]!.doc).toEqual({ n: [1] });

            // kv
            const value = { n: [1] };
            await store.state.set('a', 'k', value);
            value.n.push(2);
            const stored = (await store.state.findOne('a', 'k')) as { n: number[] };
            expect(stored).toEqual({ n: [1] });
            stored.n.push(3);
            expect(await store.state.findOne('a', 'k')).toEqual({ n: [1] });
        });

        it('artifacts.insert inserts only when the id is absent, also under concurrency', async () => {
            const { repositories: store } = await setup();
            const first = makeArtifact('a1', { filename: 'first.txt' });
            expect(await store.artifacts.insert(first, new Uint8Array([1, 2, 3]))).toBe(true);
            expect(await store.artifacts.insert(makeArtifact('a1', { filename: 'second.txt', size: 1 }), new Uint8Array([9]))).toBe(false);
            expect(await store.artifacts.findOne('a1')).toEqual(first);
            expect(Array.from((await store.artifacts.read('a1'))!)).toEqual([1, 2, 3]);

            const results = await Promise.all(
                Array.from({ length: 10 }, (_, i) => store.artifacts.insert(makeArtifact('a2', { size: 1 }), new Uint8Array([i]))),
            );
            expect(results.filter(Boolean)).toHaveLength(1);
            expect((await store.artifacts.find('r1')).filter((a) => a.id === 'a2')).toHaveLength(1);
        });

        it('artifacts.findOne and artifacts.read return metadata and plain Uint8Array bytes', async () => {
            const { repositories: store } = await setup();
            const artifact = makeArtifact('a1', { size: 4 });
            await store.artifacts.insert(artifact, new Uint8Array([0, 255, 10, 13]));
            const got = await store.artifacts.findOne('a1');
            expect(got).toEqual(artifact);
            expect(got?.createdAt).toBeInstanceOf(Date);
            expect(got).not.toHaveProperty('data');
            const bytes = await store.artifacts.read('a1');
            expect(bytes?.constructor).toBe(Uint8Array);
            expect(Array.from(bytes!)).toEqual([0, 255, 10, 13]);

            const empty = makeArtifact('a2', { size: 0, filename: undefined });
            await store.artifacts.insert(empty, new Uint8Array());
            expect((await store.artifacts.read('a2'))?.byteLength).toBe(0);
            expect((await store.artifacts.findOne('a2'))?.filename).toBeUndefined();
        });

        it('artifact reads of unknown ids are empty', async () => {
            const { repositories: store } = await setup();
            expect(await store.artifacts.findOne('nope')).toBeUndefined();
            expect(await store.artifacts.read('nope')).toBeUndefined();
            expect(await store.artifacts.find('nope')).toEqual([]);
        });

        it('artifacts.find returns the run\'s artifacts by createdAt, then id', async () => {
            const { repositories: store } = await setup();
            await store.artifacts.insert(makeArtifact('c', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.artifacts.insert(makeArtifact('b', { createdAt: new Date(1_000) }), new Uint8Array([1]));
            await store.artifacts.insert(makeArtifact('a', { createdAt: new Date(2_000) }), new Uint8Array([1]));
            await store.artifacts.insert(makeArtifact('z', { runId: 'r2', createdAt: new Date(500) }), new Uint8Array([1]));
            const listed = await store.artifacts.find('r1');
            expect(listed.map((a) => a.id)).toEqual(['b', 'a', 'c']);
            expect(listed[0]).toEqual(makeArtifact('b', { createdAt: new Date(1_000) }));
            expect((await store.artifacts.find('r2')).map((a) => a.id)).toEqual(['z']);
        });

        it('does not alias artifacts passed in or returned', async () => {
            const { repositories: store } = await setup();
            const artifact: Artifact = makeArtifact('a1');
            const data = new Uint8Array([1, 2, 3]);
            await store.artifacts.insert(artifact, data);
            data[0] = 9;
            artifact.mediaType = 'text/html';
            artifact.createdAt.setTime(0);
            expect(Array.from((await store.artifacts.read('a1'))!)).toEqual([1, 2, 3]);
            expect(await store.artifacts.findOne('a1')).toEqual(makeArtifact('a1'));

            const read = (await store.artifacts.read('a1'))!;
            read[1] = 9;
            expect(Array.from((await store.artifacts.read('a1'))!)).toEqual([1, 2, 3]);
            const got = (await store.artifacts.findOne('a1'))!;
            got.size = 99;
            const [listed] = await store.artifacts.find('r1');
            listed!.filename = 'evil';
            expect(await store.artifacts.findOne('a1')).toEqual(makeArtifact('a1'));
        });

        it('agentRevisions.findOne of an unknown agent is undefined', async () => {
            const { repositories: store } = await setup();
            expect(await store.agentRevisions.findOne('a')).toBeUndefined();
        });

        it('agentRevisions.save upserts', async () => {
            const { repositories: store } = await setup();
            await store.agentRevisions.save(makeAgentRevision('a'));
            expect(await store.agentRevisions.findOne('a')).toEqual(makeAgentRevision('a'));
            await store.agentRevisions.save(makeAgentRevision('a', { hash: 'h2', changedAt: new Date(2_000) }));
            expect(await store.agentRevisions.findOne('a')).toEqual({
                agent: 'a',
                hash: 'h2',
                changedAt: new Date(2_000),
            });
            expect(await store.agentRevisions.find()).toHaveLength(1);
        });

        it('agentRevisions.delete removes it and ignores a missing one', async () => {
            const { repositories: store } = await setup();
            await store.agentRevisions.save(makeAgentRevision('a'));
            await store.agentRevisions.save(makeAgentRevision('b'));
            await store.agentRevisions.delete('a');
            expect(await store.agentRevisions.findOne('a')).toBeUndefined();
            await expect(store.agentRevisions.delete('missing')).resolves.toBeUndefined();
            expect(await store.agentRevisions.find()).toEqual([makeAgentRevision('b')]);
        });

        it('agentRevisions.find orders by agent code point', async () => {
            const { repositories: store } = await setup();
            expect(await store.agentRevisions.find()).toEqual([]);
            await store.agentRevisions.save(makeAgentRevision('b'));
            await store.agentRevisions.save(makeAgentRevision('a-b'));
            await store.agentRevisions.save(makeAgentRevision('a'));
            expect((await store.agentRevisions.find()).map((r) => r.agent)).toEqual(['a', 'a-b', 'b']);
        });

        it('agent revisions are copied in and out', async () => {
            const { repositories: store } = await setup();
            const revision: AgentRevision = makeAgentRevision('a');
            await store.agentRevisions.save(revision);
            revision.hash = 'evil';
            revision.changedAt.setTime(0);
            expect(await store.agentRevisions.findOne('a')).toEqual(makeAgentRevision('a'));

            const got = (await store.agentRevisions.findOne('a'))!;
            expect(got.changedAt).toBeInstanceOf(Date);
            got.hash = 'evil';
            got.changedAt.setTime(0);
            const [listed] = await store.agentRevisions.find();
            expect(listed!.changedAt).toBeInstanceOf(Date);
            listed!.hash = 'evil';
            listed!.changedAt.setTime(0);
            expect(await store.agentRevisions.findOne('a')).toEqual(makeAgentRevision('a'));
            expect(await store.agentRevisions.find()).toEqual([makeAgentRevision('a')]);
        });
    });
}

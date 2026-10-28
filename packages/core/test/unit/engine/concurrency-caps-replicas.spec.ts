/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { concurrencyHarness, flush, subscription } from '../../utils/concurrency.ts';

const harnesses: ReturnType<typeof concurrencyHarness>[] = [];
function setup() {
    const h = concurrencyHarness();
    harnesses.push(h);
    return h;
}
afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.close()));
    harnesses.length = 0;
});

describe('shared-store admission', () => {
    it.each(['count', 'claim', 'transition'] as const)('releases admission and can retry after a %s failure', async (failure) => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)], { maxConcurrentRuns: 1 });
        const { runId } = await h.dispatch(engine);
        const error = new Error(`failed ${failure}`);
        let armed = true;
        const list = h.store.listRuns.bind(h.store);
        h.store.listRuns = async (query) => {
            if (armed && failure === 'count' && query?.agent === 'worker' && query.status?.includes('running')) {
                armed = false;
                throw error;
            }
            return list(query);
        };
        const claim = h.store.claimRun.bind(h.store);
        h.store.claimRun = async (...args) => {
            if (armed && failure === 'claim') { armed = false; throw error; }
            return claim(...args);
        };
        const update = h.store.updateRun.bind(h.store);
        h.store.updateRun = async (...args) => {
            if (armed && failure === 'transition' && args[1].status === 'running') { armed = false; throw error; }
            return update(...args);
        };
        await engine.start();
        await h.settle();
        expect(h.errors).toContain(error);
        expect((await h.store.getRun(runId))?.status).toBe('queued');
        expect(await h.store.acquire('admission:worker', 'probe', 1)).toBe(true);
        await h.store.release('admission:worker', 'probe');
        h.clock.advance(60_001);
        await h.settle();
        expect((await h.store.getRun(runId))?.status).toBe('running');
        expect(h.entered).toEqual([runId]);
    });

    it('frees its local reservation when a stale guarded transition is refused', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)], { maxConcurrentRuns: 1 });
        const stale = await h.dispatch(engine);
        const next = await h.dispatch(engine);
        const update = h.store.updateRun.bind(h.store);
        h.store.updateRun = async (...args) => {
            if (args[0] === stale.runId && args[1].status === 'running') {
                await update(stale.runId, { status: 'cancelled' });
            }
            return update(...args);
        };
        await engine.start();
        await h.settle();
        expect(h.entered).toEqual([next.runId]);
    });

    it('skips a locked agent without claiming its queued run', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        await h.store.acquire('admission:worker', 'other', 60_000);
        await engine.start();
        await h.settle();
        expect((await h.store.getRun(runId))?.claim).toBeUndefined();
        expect(h.entered).toEqual([]);
    });

    it('reports a release failure but still launches the transitioned execution', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        const error = new Error('release failed');
        const release = h.store.release.bind(h.store);
        h.store.release = async (...args) => {
            if (args[0] === 'admission:worker') throw error;
            return release(...args);
        };
        await engine.start();
        await h.settle();
        expect(h.errors).toContain(error);
        expect(h.entered).toEqual([runId]);
    });
    it.each(['admission:worker', 'concurrency:worker:key'])('launches and frees the local slot when reporting a failed %s release throws', async (lockKey) => {
        const h = setup();
        const failure = new Error('release failed');
        const reporterFailure = new Error('reporter failed');
        const engine = h.engine([h.agent('worker', 1)], {
            maxConcurrentRuns: 1,
            onError: (error) => {
                h.errors.push(error);
                if (error === failure) throw reporterFailure;
            },
        });
        const first = await h.dispatch(engine, 'a', { concurrencyKey: 'key' });
        const second = await h.dispatch(engine, 'a', { concurrencyKey: 'other' });
        const release = h.store.release.bind(h.store);
        let armed = true;
        h.store.release = async (key, owner) => {
            await release(key, owner);
            if (armed && key === lockKey) {
                armed = false;
                throw failure;
            }
        };

        await engine.start();
        await h.settle();
        expect(h.errors).toContain(failure);
        expect(h.entered).toEqual([first.runId]);
        expect((await engine.getRun(second.runId))?.status).toBe('queued');

        h.releases.get(first.runId)!();
        await h.settle();
        expect((await engine.getRun(first.runId))?.status).not.toBe('running');
        expect(h.entered).toEqual([first.runId, second.runId]);
    });

    it('never exceeds agent and subscription ceilings at running transitions across replicas', async () => {
        const h = setup();
        const agent = h.agent('worker', 3, [subscription('a', 1), subscription('b', 2), subscription('c', false)]);
        const a = h.engine([agent]);
        const b = h.engine([agent]);
        const running = new Map<string, string>();
        let agentPeak = 0;
        let aPeak = 0;
        let bPeak = 0;
        const update = h.store.updateRun.bind(h.store);
        h.store.updateRun = async (...args) => {
            const result = await update(...args);
            if (result?.status === 'running') {
                running.set(result.id, result.trigger.trigger);
                agentPeak = Math.max(agentPeak, running.size);
                aPeak = Math.max(aPeak, running.values().toArray().filter((id) => id === 'a').length);
                bPeak = Math.max(bPeak, running.values().toArray().filter((id) => id === 'b').length);
            } else if (result) running.delete(result.id);
            return result;
        };
        for (const trigger of ['a', 'a', 'b', 'b', 'b', 'c', 'c']) await h.dispatch(a, trigger);
        await Promise.all([a.start(), b.start()]);
        await h.settle();
        expect(h.entered).toHaveLength(3);
        for (let i = 0; i < 4; i++) {
            const id = running.keys().toArray()[0]!;
            h.releases.get(id)!();
            await h.settle();
            await Promise.all([a.tick(), b.tick()]);
            h.clock.advance(20_000);
            await h.settle();
        }
        expect(h.entered).toHaveLength(7);
        expect(agentPeak).toBe(3);
        expect(aPeak).toBe(1);
        expect(bPeak).toBeLessThanOrEqual(2);
        expect(new Set(h.entered).size).toBe(7);
    });

    it('serializes uncapped sibling starts with capped subscriptions even with equal engine owners', async () => {
        const h = setup();
        const agent = h.agent('worker', undefined, [subscription('limited', 1), subscription('free')]);
        const a = h.engine([agent], { owner: 'same-owner' });
        const b = h.engine([agent], { owner: 'same-owner' });
        const owners: string[] = [];
        const acquire = h.store.acquire.bind(h.store);
        h.store.acquire = async (...args) => {
            if (args[0] === 'admission:worker') {
                owners.push(args[1]);
                await flush();
            }
            return acquire(...args);
        };
        for (const trigger of ['limited', 'limited', 'free', 'free']) await h.dispatch(a, trigger);
        await Promise.all([a.start(), b.start()]);
        await h.settle();
        expect((await h.store.listRuns({ agent: 'worker', status: ['running'] })).total).toBe(3);
        expect(h.entered).toHaveLength(3);
        expect(owners.length).toBeGreaterThanOrEqual(4);
        expect(new Set(owners).size).toBe(owners.length);
        expect(owners).not.toContain('same-owner');
    });

    it('re-reads the live ceiling after acquiring admission', async () => {
        const h = setup();
        const agent = h.agent('worker', 2);
        const engine = h.engine([agent]);
        await h.dispatch(engine);
        const later = await h.dispatch(engine);
        const acquire = h.store.acquire.bind(h.store);
        let attempts = 0;
        h.store.acquire = async (...args) => {
            const acquired = await acquire(...args);
            if (args[0] === 'admission:worker' && acquired && ++attempts === 2) agent.definition.maxConcurrentRuns = 1;
            return acquired;
        };
        await engine.start();
        await h.settle();
        expect(h.entered).toHaveLength(1);
        expect((await h.store.getRun(later.runId))?.claim).toBeUndefined();
    });

    it('guards the running transition against a claim stolen after claiming', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        const claim = h.store.claimRun.bind(h.store);
        h.store.claimRun = async (...args) => {
            const acquired = await claim(...args);
            if (acquired) await h.store.updateRun(runId, { claim: { owner: 'thief', expiresAt: new Date(2_000_000) } });
            return acquired;
        };
        await engine.start();
        await h.settle();
        expect((await h.store.getRun(runId))?.status).toBe('queued');
        expect(h.entered).toEqual([]);
    });

    it('does not claim work blocked by a numerical ceiling', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const first = await h.dispatch(engine);
        const next = await h.dispatch(engine);
        await engine.start();
        await h.settle();
        expect((await h.store.getRun(first.runId))?.status).toBe('running');
        expect((await h.store.getRun(next.runId))?.claim).toBeUndefined();
    });

    it('fails closed on admission acquisition errors and retries refused claims', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        const error = new Error('acquire failed');
        const acquire = h.store.acquire.bind(h.store);
        let failed = false;
        h.store.acquire = async (...args) => {
            if (!failed && args[0] === 'admission:worker') { failed = true; throw error; }
            return acquire(...args);
        };
        await engine.start();
        await h.settle();
        expect(h.errors).toContain(error);
        expect((await h.store.getRun(runId))?.claim).toBeUndefined();
        const claim = h.store.claimRun.bind(h.store);
        let refused = false;
        h.store.claimRun = async (...args) => {
            if (!refused) { refused = true; return false; }
            return claim(...args);
        };
        h.clock.advance(20_000);
        await h.settle();
        expect((await h.store.getRun(runId))?.status).toBe('queued');
        expect(await h.store.acquire('admission:worker', 'probe', 1)).toBe(true);
        await h.store.release('admission:worker', 'probe');
        h.clock.advance(20_000);
        await h.settle();
        expect(h.entered).toEqual([runId]);
    });

    it('preserves claim renewal lease-loss handling for capped executions', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        await engine.start();
        await h.settle();
        await h.store.updateRun(runId, { claim: { owner: 'new-owner', expiresAt: new Date(2_000_000) } });
        h.clock.advance(20_000);
        await h.settle();
        expect(h.errors.some((error) => (error as { code?: string }).code === 'lease_lost')).toBe(true);
        expect((await h.store.getRun(runId))?.claim?.owner).toBe('new-owner');
    });

    it('re-reads a candidate that another replica settled while admission was acquired', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        const { runId } = await h.dispatch(engine);
        const acquire = h.store.acquire.bind(h.store);
        h.store.acquire = async (...args) => {
            const result = await acquire(...args);
            if (args[0] === 'admission:worker' && result) await h.store.updateRun(runId, { status: 'cancelled' });
            return result;
        };
        await engine.start();
        await h.settle();
        expect((await h.store.getRun(runId))?.status).toBe('cancelled');
        expect((await h.store.getRun(runId))?.claim).toBeUndefined();
        expect(h.entered).toEqual([]);
    });
});

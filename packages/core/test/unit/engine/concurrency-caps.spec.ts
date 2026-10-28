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
import { approve } from '@chamvi/core';
import { concurrencyHarness, subscription } from '../../utils/concurrency.ts';

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

describe('nested execution caps', () => {
    it('releases numerical capacity while waiting, preserves key exclusion, and admits approval resumes', async () => {
        const h = setup();
        const agent = h.agent('worker', 1);
        agent.definition.hooks = {
            beforeToolExecution: async (_call, ctx) => {
                if (ctx.run.trigger.payload === 'approval') await approve(ctx, { title: 'Continue?' });
            },
        };
        const engine = h.engine([agent]);
        const waiting = await h.dispatch(engine, 'a', { concurrencyKey: 'same', payload: 'approval' });
        const keyed = await h.dispatch(engine, 'a', { concurrencyKey: 'same' });
        const free = await h.dispatch(engine, 'a', { concurrencyKey: 'different' });
        await engine.start();
        await h.settle();
        const request = (await h.store.getRun(waiting.runId))!;
        expect(request.status).toBe('waiting');
        expect((await h.store.getRun(keyed.runId))?.status).toBe('queued');
        expect((await h.store.getRun(free.runId))?.status).toBe('running');
        await engine.approve(waiting.runId, { approvalId: request.waiting!.approvalId, approved: true });
        await h.settle();
        expect((await h.store.getRun(waiting.runId))?.status).toBe('queued');
        h.releases.get(free.runId)!();
        await h.settle();
        expect((await h.store.getRun(waiting.runId))?.status).toBe('running');
        expect((await h.store.getRun(keyed.runId))?.status).toBe('queued');
    });

    it('cancels queued cancellation requests even when numerical capacity is full', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 1)]);
        await h.dispatch(engine);
        const cancel = await h.dispatch(engine);
        await h.store.updateRun(cancel.runId, { cancelRequested: true });
        await engine.start();
        await h.settle();
        expect((await h.store.getRun(cancel.runId))?.status).toBe('cancelled');
        expect(h.entered).toHaveLength(1);
    });

    it('uses a lowered live cap without cancelling existing executions', async () => {
        const h = setup();
        const agent = h.agent('worker', 2);
        const engine = h.engine([agent]);
        await h.dispatch(engine);
        await h.dispatch(engine);
        await engine.start();
        await h.settle();
        agent.definition.maxConcurrentRuns = 1;
        const later = await h.dispatch(engine);
        await h.settle();
        expect((await h.store.listRuns({ status: ['running'] })).total).toBe(2);
        h.releases.get(h.entered[0]!)!();
        await h.settle();
        expect((await h.store.getRun(later.runId))?.status).toBe('queued');
        h.releases.get(h.entered[1]!)!();
        await h.settle();
        expect((await h.store.getRun(later.runId))?.status).toBe('running');
    });

    it('recovers interrupted runs through the same admission ceiling', async () => {
        const h = setup();
        const agent = h.agent('worker', 1);
        const a = h.engine([agent]);
        const first = await h.dispatch(a);
        const next = await h.dispatch(a);
        await a.start();
        await h.settle();
        const drained = a.drain({ timeoutMs: 1 });
        await h.settle();
        h.clock.advance(1);
        await drained;
        expect((await h.store.getRun(first.runId))?.status).toBe('interrupted');
        const b = h.engine([agent]);
        await b.start();
        await h.settle();
        expect((await h.store.listRuns({ status: ['running'] })).total).toBe(1);
        expect((await h.store.getRun(next.runId))?.status).toBe('queued');
    });
    it('keeps excess distinct-key work queued and starts it when capacity is released', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', 2)]);
        const ids = [];
        for (let i = 0; i < 3; i++) ids.push((await h.dispatch(engine, 'a', { concurrencyKey: `key-${i}` })).runId);
        await engine.start();
        await h.settle();
        expect((await h.store.listRuns({ status: ['running'] })).total).toBe(2);
        expect((await h.store.getRun(ids[2]!))?.status).toBe('queued');
        h.releases.get(ids[0]!)!();
        await h.settle();
        expect(h.entered).toContain(ids[2]!);
    });

    it('enforces both ceilings while later eligible subscriptions and agents pass blocked work', async () => {
        const h = setup();
        const engine = h.engine([
            h.agent('worker', 4, [subscription('a', 2), subscription('b', 1), subscription('c', false)]),
            h.agent('other', 1),
        ]);
        const ids = [];
        for (const trigger of ['a', 'a', 'a', 'b', 'b', 'c', 'unknown']) ids.push((await h.dispatch(engine, trigger)).runId);
        const other = await h.dispatch(engine, 'a', { agent: 'other' });
        await engine.start();
        await h.settle();
        const running = (await h.store.listRuns({ status: ['running'], agent: 'worker' })).data;
        expect(running).toHaveLength(4);
        expect(running.filter((r) => r.trigger.trigger === 'a')).toHaveLength(2);
        expect(running.filter((r) => r.trigger.trigger === 'b')).toHaveLength(1);
        expect((await h.store.getRun(ids[2]!))?.status).toBe('queued');
        expect((await h.store.getRun(ids[4]!))?.status).toBe('queued');
        expect((await h.store.getRun(other.runId))?.status).toBe('running');
        h.releases.get(ids[5]!)!();
        await h.settle();
        expect(h.entered).toContain(ids[6]);
    });

    it('leaves false and omitted caps unrestricted by additional admission work', async () => {
        const h = setup();
        const engine = h.engine([h.agent('worker', false, [subscription('a', false), subscription('b')])]);
        let admissions = 0;
        let counts = 0;
        const acquire = h.store.acquire.bind(h.store);
        h.store.acquire = async (...args) => {
            if (args[0].startsWith('admission:')) admissions++;
            return acquire(...args);
        };
        const list = h.store.listRuns.bind(h.store);
        h.store.listRuns = async (query) => {
            if (query?.agent === 'worker' && query.status?.includes('running')) counts++;
            return list(query);
        };
        for (const trigger of ['a', 'b', 'unknown']) await h.dispatch(engine, trigger);
        await engine.start();
        await h.settle();
        expect(h.entered).toHaveLength(3);
        expect(admissions).toBe(0);
        expect(counts).toBe(0);
    });
});

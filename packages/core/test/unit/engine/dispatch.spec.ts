/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/* eslint-disable max-classes-per-file */
import type { LanguageModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    AgentNotFoundError,
    Engine,
    TRIGGER_KEY_MAX_LENGTH,
    ValidationError,
    defineAgent,
} from '@chamvi/core';
import type { EngineOptions, Run, RunEvent } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { MemoryStore } from '../../../src/store/index.ts';
import { createChannelContext } from '../../../src/channel/helpers.ts';

const model = {} as LanguageModel;
const agent = defineAgent({
    name: 'triage',
    model,
    instructions: 'x',
});

/** Lets already-queued microtasks (all MemoryStore work) settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** Engine whose executions block until released, to observe scheduling. */
class GatedEngine extends Engine {
    gates = new Map<string, () => void>();

    executed: string[] = [];

    active = 0;

    maxActive = 0;

    /** Shared across engines to observe cross-replica overlap. */
    tracker = { active: 0, maxActive: 0 };

    failWith: Error | undefined;

    protected override async execute(run: Run): Promise<void> {
        this.executed.push(run.id);
        this.tracker.active++;
        this.tracker.maxActive = Math.max(this.tracker.maxActive, this.tracker.active);
        try {
            if (this.failWith) throw this.failWith;
            await new Promise<void>((resolve) => {
                this.gates.set(run.id, resolve);
            });
            await this.finish(run.id, { status: 'completed' });
        } finally {
            this.tracker.active--;
        }
    }

    async release(id: string): Promise<void> {
        await vi.waitFor(() => expect(this.gates.has(id)).toBe(true));
        this.gates.get(id)!();
        this.gates.delete(id);
    }
}

/** Marking a run `running` lands a few ticks late, widening the check-then-start race window. */
class SlowStartStore extends MemoryStore {
    override async updateRun(...args: Parameters<MemoryStore['updateRun']>) {
        if (args[1].status === 'running') {
            for (let i = 0; i < 5; i++) await flush();
        }
        return super.updateRun(...args);
    }
}

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

function make(opts: Partial<EngineOptions> & { store?: MemoryStore } = {}) {
    const store = opts.store ?? new MemoryStore();
    const engine = new GatedEngine({
        store,
        agents: [agent],
        onError: () => {},
        ...opts,
    });
    engines.push(engine);
    return { store, engine };
}

const env = (extra: Record<string, unknown> = {}) => ({
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: {},
    ...extra,
});

const statusOf = async (engine: Engine, id: string) => (await engine.getRun(id))?.status;

describe('Engine.dispatch', () => {
    it('dispatch creates queued run', async () => {
        const { engine } = make();
        const { runId, deduplicated } = await engine.dispatch(env());
        expect(deduplicated).toBe(false);
        const run = await engine.getRun(runId);
        expect(run?.status).toBe('queued');
        expect(run?.agent).toBe('triage');
        expect(run?.trigger.id).toBeTruthy();
    });

    it('dispatch dedupes identical idempotencyKey', async () => {
        const { engine } = make();
        const a = await engine.dispatch(env({ idempotencyKey: 'k' }));
        const b = await engine.dispatch(env({ idempotencyKey: 'k' }));
        expect(b).toEqual({ runId: a.runId, deduplicated: true });
        const c = await engine.dispatch(env());
        const d = await engine.dispatch(env());
        expect(c.runId).not.toBe(d.runId);
    });

    it('dispatch dedupes concurrent identical keys', async () => {
        const { engine, store } = make();
        const results = await Promise.all(
            Array.from({ length: 10 }, () => engine.dispatch(env({ idempotencyKey: 'same' }))),
        );
        expect(new Set(results.map((r) => r.runId)).size).toBe(1);
        expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
        expect((await store.listRuns({})).total).toBe(1);
    });

    it.each(['idempotencyKey', 'concurrencyKey', 'address'])('refuses a %s above TRIGGER_KEY_MAX_LENGTH or with a NUL before any store write', async (key) => {
        const { engine, store } = make();
        for (const value of ['k'.repeat(TRIGGER_KEY_MAX_LENGTH + 1), 'a\u0000b']) {
            await expect(engine.dispatch(env({ [key]: value }))).rejects.toBeInstanceOf(ValidationError);
        }
        expect((await store.listRuns({})).total).toBe(0);
        const { deduplicated } = await engine.dispatch(env({ [key]: 'k'.repeat(TRIGGER_KEY_MAX_LENGTH) }));
        expect(deduplicated).toBe(false);
    });

    it('rejects two agents with the same name', () => {
        const other = defineAgent({
            name: 'triage',
            model,
            instructions: 'y',
        });
        expect(() => new Engine({
            store: new MemoryStore(),
            agents: [agent, other],
        })).toThrow(/"triage" is used more than once/);
    });

    it('a redelivery heals an idempotency key whose run was never created', async () => {
        const { engine, store } = make();
        vi.spyOn(store, 'createRun').mockRejectedValueOnce(new Error('store down'));
        await expect(engine.dispatch(env({ idempotencyKey: 'k' }))).rejects.toThrow('store down');
        expect((await store.listRuns({})).total).toBe(0);

        const retried = await engine.dispatch(env({ idempotencyKey: 'k' }));
        expect(retried.deduplicated).toBe(false);
        expect((await engine.getRun(retried.runId))?.status).toBe('queued');
        expect(await engine.dispatch(env({ idempotencyKey: 'k' }))).toEqual({ runId: retried.runId, deduplicated: true });
        expect((await store.listRuns({})).total).toBe(1);
    });

    it('concurrent healers of a lost run create it once', async () => {
        const { engine, store } = make();
        vi.spyOn(store, 'createRun').mockRejectedValueOnce(new Error('store down'));
        await expect(engine.dispatch(env({ idempotencyKey: 'k' }))).rejects.toThrow('store down');
        const results = await Promise.all(
            Array.from({ length: 5 }, () => engine.dispatch(env({ idempotencyKey: 'k' }))),
        );
        expect(new Set(results.map((r) => r.runId)).size).toBe(1);
        expect(results.filter((r) => !r.deduplicated)).toHaveLength(1);
        expect((await store.listRuns({})).total).toBe(1);
    });

    it('dispatch rejects unknown agent', async () => {
        const { engine, store } = make();
        await expect(engine.dispatch(env({ agent: 'nope' }))).rejects.toThrow(AgentNotFoundError);
        await expect(engine.dispatch(env({ agent: 'nope' }))).rejects.toThrow('unknown agent: nope');
        expect((await store.listRuns({})).total).toBe(0);
    });

    it('runs with the same concurrencyKey execute one at a time', async () => {
        const { engine } = make();
        const events: string[] = [];
        engine.on('run.updated', (e: RunEvent) => {
            if (e.type === 'run.updated') events.push(`${e.run.id}:${e.run.status}`);
        });
        await engine.start();
        const a = await engine.dispatch(env({ concurrencyKey: 'c' }));
        const b = await engine.dispatch(env({ concurrencyKey: 'c' }));
        await vi.waitFor(() => expect(engine.executed).toEqual([a.runId]));
        await flush();
        expect(engine.executed).toEqual([a.runId]);
        await engine.release(a.runId);
        await vi.waitFor(() => expect(engine.executed).toEqual([a.runId, b.runId]));
        await engine.release(b.runId);
        await engine.idle();
        expect(events.filter((e) => !e.endsWith('queued'))).toEqual([
            `${a.runId}:running`,
            `${a.runId}:completed`,
            `${b.runId}:running`,
            `${b.runId}:completed`,
        ]);
    });

    it('does not start a run while a waiting run holds the same concurrencyKey', async () => {
        const { engine, store } = make();
        const other = await engine.dispatch(env({ concurrencyKey: 'c' }));
        await store.updateRun(other.runId, { status: 'waiting' });
        await engine.start();
        await engine.dispatch(env({ concurrencyKey: 'c' }));
        await flush();
        expect(engine.executed).toEqual([]);
    });

    it('different concurrencyKeys run in parallel', async () => {
        const { engine } = make();
        await engine.start();
        const a = await engine.dispatch(env({ concurrencyKey: 'a' }));
        const b = await engine.dispatch(env({ concurrencyKey: 'b' }));
        await vi.waitFor(() => expect(engine.executed.toSorted()).toEqual([a.runId, b.runId].toSorted()));
        await engine.release(a.runId);
        await engine.release(b.runId);
        await engine.idle();
    });

    it('maxConcurrentRuns is respected and starts are FIFO', async () => {
        const { engine } = make({ maxConcurrentRuns: 2 });
        await engine.start();
        const ids: string[] = [];
        for (let i = 0; i < 4; i++) ids.push((await engine.dispatch(env())).runId);
        await vi.waitFor(() => expect(engine.executed).toEqual([ids[0], ids[1]]));
        await flush();
        expect(engine.executed).toEqual([ids[0], ids[1]]);
        await engine.release(ids[0]!);
        await vi.waitFor(() => expect(engine.executed).toEqual([ids[0], ids[1], ids[2]]));
        await engine.release(ids[1]!);
        await engine.release(ids[2]!);
        await vi.waitFor(() => expect(engine.executed).toHaveLength(4));
        await engine.release(ids[3]!);
        await engine.idle();
        for (const id of ids) expect(await statusOf(engine, id)).toBe('completed');
    });

    it('same-key runs on two replicas sharing a store never overlap', async () => {
        const store = new SlowStartStore();
        // real timers: the lease must outlive a renewal delayed by a loaded machine,
        // or the other replica recovers the running run and executes it again
        const a = make({
            store,
            owner: 'a',
            claimTtlMs: 600,
        });
        const b = make({
            store,
            owner: 'b',
            claimTtlMs: 600,
        });
        b.engine.tracker = a.engine.tracker;
        const [ra, rb] = await Promise.all([
            a.engine.dispatch(env({ concurrencyKey: 'c' })),
            b.engine.dispatch(env({ concurrencyKey: 'c' })),
        ]);
        await Promise.all([a.engine.start(), b.engine.start()]);
        const holder = (id: string) => (a.engine.gates.has(id) ? a.engine : b.engine);
        await vi.waitFor(() => expect(a.engine.executed.length + b.engine.executed.length).toBe(1));
        for (let i = 0; i < 15; i++) await flush();
        expect(a.engine.executed.length + b.engine.executed.length).toBe(1);
        expect(a.engine.tracker.maxActive).toBe(1);
        const first = a.engine.executed[0] ?? b.engine.executed[0]!;
        await holder(first).release(first);
        const second = first === ra.runId ? rb.runId : ra.runId;
        await vi.waitFor(() => expect(a.engine.executed.length + b.engine.executed.length).toBe(2));
        await holder(second).release(second);
        await vi.waitFor(async () => expect(await statusOf(a.engine, second)).toBe('completed'));
        expect(a.engine.tracker.maxActive).toBe(1);
    });

    it('picks up a run unblocked outside this process once the poll fires', async () => {
        const clock = new ControllableClock(new Date('2026-01-01T00:00:00Z'));
        const store = new MemoryStore({ clock });
        const { engine } = make({
            store,
            clock,
            claimTtlMs: 300,
        });
        const blocker = await engine.dispatch(env({ concurrencyKey: 'c' }));
        // running on another replica, which holds a live claim (recovery leaves it alone)
        await store.claimRun(blocker.runId, 'elsewhere', 60_000);
        await store.updateRun(blocker.runId, { status: 'running' });
        await engine.start();
        const { runId } = await engine.dispatch(env({ concurrencyKey: 'c' }));
        await flush();
        expect(await statusOf(engine, runId)).toBe('queued');

        await store.updateRun(blocker.runId, { status: 'completed' });
        clock.advance(100);
        await vi.waitFor(() => expect(engine.executed).toEqual([runId]));
        await engine.release(runId);
        await engine.idle();
        expect(await statusOf(engine, runId)).toBe('completed');
    });

    it('a store failure inside a pass is reported, not thrown', async () => {
        const store = new MemoryStore();
        const onError = vi.fn();
        const { engine } = make({ store, onError });
        vi.spyOn(store, 'listRuns').mockRejectedValueOnce(new Error('boom'));
        await engine.dispatch(env());
        await expect(engine.start()).resolves.toBeUndefined();
        expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'boom' });
    });

    it('an execute throw marks the run failed and releases the claim', async () => {
        const onError = vi.fn();
        const { engine, store } = make({ onError });
        engine.failWith = Object.assign(new Error('nope'), { code: 'tool_broke' });
        const updates: Run['status'][] = [];
        engine.on('run.updated', (e) => {
            if (e.type === 'run.updated') updates.push(e.run.status);
        });
        await engine.start();
        const { runId } = await engine.dispatch(env());
        await engine.idle();
        const run = await store.getRun(runId);
        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'tool_broke', message: 'nope' });
        expect(run?.claim).toBeUndefined();
        expect(updates).toContain('failed');
        expect(onError).toHaveBeenCalled();
    });

    it('a throwing listener does not break the engine', async () => {
        const onError = vi.fn();
        const { engine } = make({ onError });
        engine.on('run.updated', () => {
            throw new Error('listener');
        });
        const { runId } = await engine.dispatch(env());
        expect(await statusOf(engine, runId)).toBe('queued');
        expect(onError).toHaveBeenCalled();
    });

    it('a throwing lock release does not strand the run', async () => {
        const store = new MemoryStore();
        const onError = vi.fn();
        const { engine } = make({ store, onError });
        vi.spyOn(store, 'release').mockRejectedValueOnce(new Error('release failed'));
        await engine.start();
        const { runId } = await engine.dispatch(env({ concurrencyKey: 'c' }));
        await engine.release(runId);
        await engine.idle();
        expect(await statusOf(engine, runId)).toBe('completed');
        expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: 'release failed' });
    });

    it('stop() then start() keeps a single poll chain', async () => {
        const clock = new ControllableClock();
        const store = new MemoryStore({ clock });
        const { engine } = make({
            store,
            clock,
            claimTtlMs: 300,
        });
        const list = vi.spyOn(store, 'listRuns');
        await engine.start();
        // a poll pass is in flight when the engine is restarted
        clock.advance(100);
        engine.stop();
        await engine.start();
        await flush();
        list.mockClear();
        clock.advance(100);
        await flush();
        await flush();
        // one chain means one approval expiry check, one recovery and one scheduling pass per poll tick
        const statuses = list.mock.calls.map(([q]) => q.status?.join());
        expect(statuses).toEqual(['waiting', 'running,interrupted', 'queued']);
    });
});

describe('Engine.on', () => {
    it('narrows the listener to the event type', async () => {
        const { engine } = make();
        const statuses: string[] = [];
        const ids: string[] = [];
        const offRun = engine.on('run.updated', (e) => {
            statuses.push(e.run.status);
        });
        const offStep = engine.on('step.appended', (e) => {
            ids.push(e.step.runId);
            // @ts-expect-error a step.appended event carries no run
            expect(e.run).toBeUndefined();
        });
        await engine.dispatch(env());
        offRun();
        offStep();
        expect(statuses).toEqual(['queued']);
        expect(ids).toEqual([]);
    });
});

describe('dispatch keeps lineage private', () => {
    const parent = {
        kind: 'handoff' as const,
        runId: 'x',
        agent: 'triage',
        depth: 1,
    };

    it('dispatch drops a parent from the envelope', async () => {
        const { engine, store } = make();
        const { runId } = await engine.dispatch({ ...env(), parent } as never);
        expect((await store.getRun(runId))!.trigger.parent).toBeUndefined();
    });

    it("a channel's ctx.dispatch drops a parent", async () => {
        const { engine, store } = make();
        const { runId } = await createChannelContext(engine, { name: 'http' }).dispatch({ ...env(), parent } as never);
        const run = await store.getRun(runId);
        expect(run!.trigger.parent).toBeUndefined();
        expect(run!.trigger.channel).toBe('http');
    });
});

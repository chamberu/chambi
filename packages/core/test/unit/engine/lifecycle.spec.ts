/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/* eslint-disable max-classes-per-file */
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { tool } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidRunStateError,
    LeaseLostError,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    EngineOptions,
    IEngine,
    IStore,
    Run,
    RunEvent,
} from '@chamvi/core';
import type { IClock } from '../../../src/clock/index.ts';
import { systemClock } from '../../../src/clock/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { MemoryRunRepository, createMemoryStore } from '../../../src/repository/index.ts';
import { mockModel } from '../../utils/mock-model.ts';
import { createMemoryStoreWithRuns } from '../../utils/store.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: IEngine[] = [];

/** Lets already-queued microtasks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
    vi.restoreAllMocks();
});

/** One model turn: a response, optionally held until `before` resolves, or a call that only settles by aborting. */
type Turn = MockResponse | 'hang' | { before: () => Promise<void>; response: MockResponse };

/** A model shared by several engines: turn N of the script answers the Nth call, whichever engine makes it. */
function scripted(script: Turn[]) {
    const calls: LanguageModelV4CallOptions[] = [];
    const model = new MockLanguageModelV4({
        doStream: async (options) => {
            const turn = script[calls.length];

            calls.push(options);

            if (!turn) {
                throw new Error('mock script exhausted');
            }

            if (turn === 'hang') {
                return new Promise((_resolve, reject) => {
                    options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
                });
            }

            if ('before' in turn) {
                await turn.before();

                return mockModel([turn.response]).doStream(options);
            }

            return mockModel([turn]).doStream(options);
        },
    });

    return { model, calls };
}

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

const toolTurn: MockResponse = {
    parts: [{
        type: 'tool-call',
        toolName: 'lookup',
        input: { q: 1 },
    }],
};

function make(
    model: LanguageModel,
    opts: Partial<EngineOptions> & { store?: IStore; tools?: () => ToolSet } = {},
) {
    const store = opts.store ?? createMemoryStore({ clock: opts.clock });
    const errors: unknown[] = [];
    const events: RunEvent[] = [];
    const agent = defineAgent({
        name: 'triage',
        instructions: 'You triage.',
        model,
        tools: opts.tools,
    });
    const engine = new Engine({
        store,
        agents: [agent],
        onError: (error) => {
            errors.push(error);
        },
        ...opts,
    });

    engine.on('run.updated', (e) => {
        events.push(e);
    });
    engine.on('step.appended', (e) => {
        events.push(e);
    });
    engines.push(engine);

    return {
        store,
        engine,
        errors,
        events,
    };
}

const env = {
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: { issue: 42 },
};

const lookupTools = () => ({
    lookup: tool({
        inputSchema: z.object({ q: z.number() }),
        execute: async () => 'found',
    }),
});

/** Real time for timestamps, manually fired timers (polls, renewals). */
class ManualTimers extends ControllableClock {
    override now(): Date {
        return new Date();
    }
}

/** Hands the run's claim to owner 'B' right before the first write that sets `status` to `on`. */
class TakeoverRepository extends MemoryRunRepository {
    takeoverOn: Run['status'] | undefined;

    override async update(...args: Parameters<MemoryRunRepository['update']>) {
        const [id, patch] = args;

        if (this.takeoverOn !== undefined && patch.status === this.takeoverOn) {
            this.takeoverOn = undefined;
            await super.update(id, { claim: { owner: 'B', expiresAt: new Date(Date.now() + 60_000) } });
        }

        return super.update(...args);
    }
}

const isLeaseLost = (error: unknown) => error instanceof LeaseLostError;

function makeRun(id: string, overrides: Partial<Run> = {}): Run {
    const createdAt = new Date(1_000);

    return {
        id,
        agent: 'triage',
        status: 'running',
        trigger: {
            ...env,
            id: `t-${id}`,
            receivedAt: createdAt,
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

describe('graceful drain', () => {
    it.each([false, true])('bounds detached approval delivery by the drain deadline (active run: %s)', async (active) => {
        const clock = new ControllableClock();
        const store = createMemoryStore({ clock });
        const entered = Promise.withResolvers<void>();
        const delivered = Promise.withResolvers<void>();
        let signal: AbortSignal | undefined;
        const ask = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => context.channels.findOneOrFail().approve({ title: 'Approve?' }),
        });
        const agent = defineAgent({
            name: 'a',
            instructions: 'Test',
            model: mockModel([{
                parts: [{
                    type: 'tool-call',
                    toolName: 'ask',
                    input: {},
                }],
            }]),
            tools: { ask },
        });
        const engine = new Engine({
            agents: [agent, defineAgent({
                name: 'worker',
                instructions: 'Test',
                model: new MockLanguageModelV4({ doStream: async () => new Promise(() => {}) }),
            })],
            store,
            clock,
            claimTtlMs: 60_000,
            onError: () => {},
            channels: [{
                name: 'chat',
                out: async (_message, _address, context) => {
                    signal = context.signal;
                    entered.resolve();
                    await delivered.promise;
                },
            }],
        });

        engines.push(engine);
        await engine.start();

        const { runId } = await engine.dispatch({
            agent: 'a',
            trigger: 'message',
            channel: 'chat',
            address: 'source',
            payload: {},
        });

        await engine.tick();
        await entered.promise;
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');

        let activeRunId: string | undefined;

        if (active) {
            activeRunId = (await engine.dispatch({
                agent: 'worker',
                trigger: 'work',
                channel: 'chat',
                payload: {},
            })).runId;
            await engine.tick();
            await flush();
        }

        let completed = false;
        const draining = engine.drain({ timeoutMs: 10 }).then(() => {
            completed = true;
        });

        await flush();
        expect(completed).toBe(false);
        clock.advance(10);
        await flush();

        try {
            expect(completed).toBe(true);
            expect(signal?.aborted).toBe(true);
            expect((await store.runs.findOne(runId))?.status).toBe('waiting');

            if (activeRunId) {
                expect((await store.runs.findOne(activeRunId))?.status).toBe('interrupted');
            }

            delivered.resolve();
            await flush();
            expect((await store.runs.findOne(runId))?.waiting?.notifiedAt).toBeUndefined();
        } finally {
            clock.advance(60_000);
            await draining;
        }
    });

    it('drain waits for short runs to complete', async () => {
        const { model, calls } = scripted([{ before: () => sleep(30), response: text('done') }]);
        const {
            engine,
            store,
            errors,
        } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        expect(engine.isDraining).toBe(false);

        const drained = engine.drain({ timeoutMs: 5_000 });

        expect(engine.isDraining).toBe(true);

        // a run dispatched meanwhile is stored, but its slot freeing up does not start it
        const { runId: later } = await engine.dispatch(env);

        await drained;

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        await engine.idle();
        expect((await store.runs.findOne(later))?.status).toBe('queued');
        expect(calls).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    it('drain marks in-flight runs interrupted', async () => {
        const { model, calls } = scripted([toolTurn, 'hang']);
        const lookup = vi.fn(async () => 'found');
        const {
            engine,
            store,
            errors,
        } = make(model, {
            tools: () => ({
                lookup: tool({
                    inputSchema: z.object({ q: z.number() }),
                    execute: lookup,
                }),
            }),
        });

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(2));

        const timers = vi.spyOn(systemClock, 'setTimeout');

        await engine.drain({ timeoutMs: 50 });

        // the deadline keeps the process alive, so the run is marked before exit
        expect(timers).toHaveBeenCalledWith(expect.any(Function), 50, { keepAlive: true });

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('interrupted');
        expect(run?.claim).toBeUndefined();
        expect(run?.finishedAt).toBeUndefined();
        expect(run?.error).toBeUndefined();
        expect((await store.checkpoints.findOne(runId))?.stepIndex).toBe(0);
        expect(errors).toEqual([]);
    });

    it('only the drain deadline holds the event loop open', () => {
        const native = vi.spyOn(globalThis, 'setTimeout');
        const kept = systemClock.setTimeout(() => {}, 10_000, { keepAlive: true });
        const unref = systemClock.setTimeout(() => {}, 10_000);
        const [keptHandle, unrefHandle] = native.mock.results.map((r) => r.value as NodeJS.Timeout);

        expect(keptHandle?.hasRef()).toBe(true);
        expect(unrefHandle?.hasRef()).toBe(false);
        kept.clear();
        unref.clear();

        const manual = new ControllableClock();
        const asClock: IClock = manual;
        let fired = false;

        asClock.setTimeout(() => {
            fired = true;
        }, 10, { keepAlive: true });
        manual.advance(10);
        expect(fired).toBe(true);
    });

    it('an interrupted keyed run blocks its key until it is recovered and completed', async () => {
        const { model, calls } = scripted([toolTurn, 'hang', text('first done'), text('second done')]);
        const store = createMemoryStore();
        const keyed = { ...env, concurrencyKey: 'issue-42' };
        const a = make(model, {
            store,
            tools: lookupTools,
            owner: 'A',
        });
        const bClock = new ManualTimers();
        const b = make(model, {
            store,
            tools: lookupTools,
            owner: 'B',
            clock: bClock,
            claimTtlMs: 900,
        });

        await b.engine.start();
        await a.engine.start();

        const { runId: first } = await a.engine.dispatch(keyed);

        await vi.waitFor(() => expect(calls).toHaveLength(2));
        await a.engine.drain({ timeoutMs: 50 });
        expect((await store.runs.findOne(first))?.status).toBe('interrupted');

        // a redelivery on the live replica waits behind the interrupted first pass
        const { runId: second } = await b.engine.dispatch(keyed);

        await b.engine.idle();
        expect((await store.runs.findOne(second))?.status).toBe('queued');
        expect(calls).toHaveLength(2);

        // the next poll recovers the first run; it completes before the second starts
        bClock.advance(300);
        await flush();
        await b.engine.idle();

        const firstRun = await store.runs.findOne(first);
        const secondRun = await store.runs.findOne(second);

        expect(firstRun).toMatchObject({ status: 'completed', output: 'first done' });
        expect(secondRun).toMatchObject({ status: 'completed', output: 'second done' });
        expect(secondRun!.startedAt!.getTime()).toBeGreaterThanOrEqual(firstRun!.finishedAt!.getTime());
        expect(calls).toHaveLength(4);

        const hasLookupResult = (i: number) => calls[i]!.prompt.some((m) => m.role === 'tool' &&
            m.content.some((p) => p.type === 'tool-result' && p.toolName === 'lookup'));

        // the model sees the interrupted run's resumed prompt first
        expect(hasLookupResult(2)).toBe(true);
        expect(hasLookupResult(3)).toBe(false);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('a drain landing during the step-end writes keeps the completed step, so recovery does not redo it', async () => {
        const calls: LanguageModelV4CallOptions[] = [];
        const model = new MockLanguageModelV4({
            doStream: async (options) => {
                if (options.abortSignal?.aborted) {
                    throw options.abortSignal.reason;
                }

                calls.push(options);

                return mockModel([calls.length === 1 ? toolTurn : text('done')]).doStream(options);
            },
        });
        const lookup = vi.fn(async () => 'found');
        const tools = () => ({
            lookup: tool({
                inputSchema: z.object({ q: z.number() }),
                execute: lookup,
            }),
        });
        const { promise: held, resolve: release } = Promise.withResolvers<void>();
        let holding = false;
        const store = createMemoryStore();
        const append = store.steps.insert.bind(store.steps);

        vi.spyOn(store.steps, 'insert').mockImplementation(async (step) => {
            if (step.kind === 'llm' && step.index === 0) {
                holding = true;
                await held;
            }

            return append(step);
        });

        const clock = new ManualTimers();
        const a = make(model, {
            store,
            tools,
            owner: 'A',
            clock,
        });

        await a.engine.start();

        const { runId } = await a.engine.dispatch(env);

        await vi.waitFor(() => expect(holding).toBe(true));

        // the deadline passes while step 0 (tool already executed) is being written
        const drained = a.engine.drain({ timeoutMs: 50 });

        await flush();
        clock.advance(50);
        await flush();
        release();
        await drained;

        expect((await store.runs.findOne(runId))?.status).toBe('interrupted');
        expect((await store.steps.find(runId)).map((step) => step.kind)).toEqual(['llm', 'tool']);
        expect((await store.checkpoints.findOne(runId))?.stepIndex).toBe(0);

        const b = make(model, {
            store,
            tools,
            owner: 'B',
        });

        await b.engine.start();
        await b.engine.idle();
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        // one model call per step: step 0 was not asked again, its tool ran once
        expect(calls).toHaveLength(2);
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('dispatch during drain stores queued run but does not start it', async () => {
        const clock = new ControllableClock();
        const { model, calls } = scripted([text('done')]);
        const { engine, store } = make(model, { clock, claimTtlMs: 900 });

        await engine.start();
        await engine.drain();

        const tick = vi.spyOn(engine, 'tick');

        const {
            runId,
            deduplicated,
        } = await engine.dispatch(env);

        expect(deduplicated).toBe(false);

        // polling (and with it tick) stopped too
        for (let i = 0; i < 5; i++) {
            clock.advance(900);
            await flush();
        }

        await engine.idle();

        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect(calls).toHaveLength(0);
        expect(tick).not.toHaveBeenCalled();
    });
});

describe('recovery', () => {
    it('recover resumes from last checkpoint', async () => {
        const { model, calls } = scripted([toolTurn, 'hang', text('done')]);
        const lookup = vi.fn(async () => 'found');
        const tools = () => ({
            lookup: tool({
                inputSchema: z.object({ q: z.number() }),
                execute: lookup,
            }),
        });
        const store = createMemoryStore();
        const a = make(model, {
            store,
            tools,
            owner: 'A',
        });
        const b = make(model, {
            store,
            tools,
            owner: 'B',
        });

        await a.engine.start();

        const { runId } = await a.engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(2));
        await a.engine.drain({ timeoutMs: 50 });
        expect((await store.runs.findOne(runId))?.status).toBe('interrupted');

        await b.engine.start();
        await b.engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run).toMatchObject({ status: 'completed', output: 'done' });
        expect(run?.claim).toBeUndefined();
        // step 0 (the tool call) was checkpointed: B continues after it instead of asking for it again
        expect(calls).toHaveLength(3);
        expect(lookup).toHaveBeenCalledTimes(1);

        const resumedPrompt = calls[2]!.prompt;

        expect(resumedPrompt.some((m) => m.role === 'tool' &&
            m.content.some((p) => p.type === 'tool-result' && p.toolName === 'lookup'))).toBe(true);
        // the restored history holds A's tool call, not a fresh start from the trigger
        expect(resumedPrompt.some((m) => m.role === 'assistant' && Array.isArray(m.content) &&
            m.content.some((p) => p.type === 'tool-call' && p.toolName === 'lookup'))).toBe(true);
        expect((await store.checkpoints.findOne(runId))?.stepIndex).toBe(1);

        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'tool', 'llm']);
        expect(steps.map((s) => s.index)).toEqual([0, 1, 2]);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('recover ignores runs with a live claim from another owner', async () => {
        const clock = new ControllableClock(new Date(10_000));
        const store = createMemoryStore({ clock });

        await store.runs.insert(makeRun('live'));
        await store.runs.claim('live', 'other', 60_000);
        await store.runs.insert(makeRun('expired'));
        await store.runs.claim('expired', 'other', 1_000);
        await store.runs.insert(makeRun('interrupted', { status: 'interrupted' }));
        await store.runs.insert(makeRun('waiting', { status: 'waiting' }));
        clock.advance(1_000);

        const { engine } = make(scripted([]).model, { store, clock });

        expect(await engine.recover()).toBe(2);

        expect(await store.runs.findOne('live')).toMatchObject({ status: 'running', claim: { owner: 'other' } });
        expect(await store.runs.findOne('expired')).toMatchObject({ status: 'queued' });
        expect((await store.runs.findOne('expired'))?.claim).toBeUndefined();
        expect(await store.runs.findOne('interrupted')).toMatchObject({ status: 'queued' });
        expect((await store.runs.findOne('waiting'))?.status).toBe('waiting');
    });

    it('rejects late writes of an execution whose lease expired and was recovered elsewhere', async () => {
        // A's process stalls (its own clock never moves, so it never renews) while the lease expires in the store
        const shared = new ControllableClock();
        const store = createMemoryStore({ clock: shared });
        const { promise: stalled, resolve: release } = Promise.withResolvers<void>();
        const { model, calls } = scripted([{ before: () => stalled, response: text('A late') }, text('B done')]);
        const a = make(model, {
            store,
            clock: new ControllableClock(),
            owner: 'A',
            claimTtlMs: 1_000,
        });
        const b = make(model, {
            store,
            clock: shared,
            owner: 'B',
            claimTtlMs: 1_000,
        });

        await a.engine.start();

        const { runId } = await a.engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        shared.advance(1_001);
        await b.engine.start();
        await b.engine.idle();
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'B done' });

        const before = a.events.length;

        release();
        await a.engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run).toMatchObject({ status: 'completed', output: 'B done' });
        expect(run?.claim).toBeUndefined();

        const steps = await store.steps.find(runId);

        expect(steps).toHaveLength(1);
        expect(steps[0]?.output).toMatchObject({ text: 'B done' });

        const checkpoint = await store.checkpoints.findOne(runId);

        expect(JSON.stringify(checkpoint?.messages)).toContain('B done');
        expect(JSON.stringify(checkpoint?.messages)).not.toContain('A late');
        expect(a.events.slice(before)).toEqual([]);
        // the lost lease is reported once, typed, with the run id
        expect(a.errors).toHaveLength(1);
        expect(a.errors[0]).toBeInstanceOf(LeaseLostError);
        expect((a.errors[0] as LeaseLostError).runId).toBe(runId);
    });

    it('an execution that fails to renew its lease stops without writing, and is recovered after expiry', async () => {
        class FlakyRepository extends MemoryRunRepository {
            renewFails = false;

            override async renewClaim(...args: Parameters<MemoryRunRepository['renewClaim']>) {
                if (this.renewFails) {
                    return false;
                }

                return super.renewClaim(...args);
            }
        }
        const clock = new ControllableClock();
        const store = createMemoryStoreWithRuns(new FlakyRepository({ clock }), { clock });
        const { promise: stalled, resolve: release } = Promise.withResolvers<void>();
        const { model, calls } = scripted([{ before: () => stalled, response: text('late') }, text('again')]);
        const { engine, errors } = make(model, {
            store,
            clock,
            owner: 'A',
            claimTtlMs: 900,
        });

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        store.runs.renewFails = true;
        clock.advance(300);
        await engine.idle();
        release();
        await flush();
        await engine.idle();

        // nothing written: the run keeps its (soon expired) claim and waits for recovery
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'running', claim: { owner: 'A' } });
        expect(await store.steps.find(runId)).toEqual([]);
        expect(await store.checkpoints.findOne(runId)).toBeUndefined();

        store.runs.renewFails = false;
        clock.advance(1_000);
        await engine.recover();
        await engine.idle();
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'again' });
        expect(calls).toHaveLength(2);
        expect(errors).toHaveLength(1);
        expect(errors.every(isLeaseLost)).toBe(true);
    });

    it('finish writes nothing when the claim is taken over after the last ownership check', async () => {
        const store = createMemoryStoreWithRuns(new TakeoverRepository());

        store.runs.takeoverOn = 'completed';

        const { model } = scripted([text('late')]);
        const {
            engine,
            errors,
            events,
        } = make(model, { store, owner: 'A' });

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        // the atomic expectOwner check in the store rejected the settle
        const run = await store.runs.findOne(runId);

        expect(run).toMatchObject({ status: 'running', claim: { owner: 'B' } });
        expect(run?.output).toBeUndefined();
        expect(events.some((e) => e.type === 'run.updated' && e.run.status === 'completed')).toBe(false);
        expect(errors).toHaveLength(1);
        expect(errors.every(isLeaseLost)).toBe(true);
    });

    it('cancel on another replica stops a running run on its next poll', async () => {
        const { model, calls } = scripted(['hang']);
        const store = createMemoryStore();
        const clock = new ManualTimers();
        const a = make(model, {
            store,
            owner: 'A',
            clock,
            claimTtlMs: 900,
        });
        const b = make(model, { store, owner: 'B' });

        await a.engine.start();

        const { runId } = await a.engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        await b.engine.cancel(runId);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'running', cancelRequested: true });

        clock.advance(300);
        await flush();
        await a.engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run).toMatchObject({ status: 'cancelled', claim: undefined });
        expect(run?.finishedAt).toBeInstanceOf(Date);
        expect(calls[0]?.abortSignal?.aborted).toBe(true);
        expect(a.errors).toEqual([]);
        expect(b.errors).toEqual([]);
    });

    it('a cancel requested for an interrupted run settles it on recovery without a model call', async () => {
        const { model, calls } = scripted([text('never')]);
        const {
            engine,
            store,
            errors,
        } = make(model);

        await store.runs.insert(makeRun('r1', { status: 'interrupted' }));

        await engine.cancel('r1');
        expect(await store.runs.findOne('r1')).toMatchObject({ status: 'interrupted', cancelRequested: true });
        await engine.start();
        await engine.idle();

        expect((await store.runs.findOne('r1'))?.status).toBe('cancelled');
        expect(calls).toHaveLength(0);
        expect(errors).toEqual([]);
    });

    it('cancel throws when the execution loses its lease while being cancelled', async () => {
        const store = createMemoryStoreWithRuns(new TakeoverRepository());
        const { model, calls } = scripted(['hang']);
        const { engine, errors } = make(model, { store, owner: 'A' });

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));

        store.runs.takeoverOn = 'cancelled';
        await expect(engine.cancel(runId)).rejects.toBeInstanceOf(InvalidRunStateError);
        await engine.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'running', claim: { owner: 'B' } });
        expect(errors).toHaveLength(1);
        expect(errors.every(isLeaseLost)).toBe(true);
    });
});

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MockLanguageModelV4 } from 'ai/test';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    Engine,
    MemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { SkillInput } from '@chamvi/core';
import type { RunJobResult } from '@chamvi/channel-cron';
import { cron, cronChannel, runJob } from '@chamvi/channel-cron';
import { ControllableClock, fakeSkillRuntime } from '@chamvi/test-kit';

const T = new Date('2026-03-01T08:00:00.000Z');
const POLL_MS = 1_000;
const DRAIN_MS = 5_000;

/** A model that never answers: its stream rejects only when the run aborts. */
function hangingModel() {
    const hang = (signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
    return new MockLanguageModelV4({
        doGenerate: async (options) => hang(options.abortSignal),
        doStream: async (options) => hang(options.abortSignal),
    });
}

function setup(skills?: SkillInput[]) {
    const clock = new ControllableClock(T);
    const store = new MemoryStore({ clock });
    const agent = defineAgent({
        name: 'sweep',
        model: hangingModel(),
        instructions: 'x',
        channels: [cron.on('*/5 * * * *')],
    });
    const engine = new Engine({
        store,
        agents: [agent],
        channels: [cronChannel()],
        clock,
        skills,
    });
    return {
        clock,
        store,
        agent,
        engine,
    };
}

async function abortWhileRunning(ctx: ReturnType<typeof setup>) {
    const controller = new AbortController();
    let result: RunJobResult | undefined;
    const job = runJob({
        engine: ctx.engine,
        agent: ctx.agent,
        pollMs: POLL_MS,
        drainTimeoutMs: DRAIN_MS,
        signal: controller.signal,
    }).then((r) => {
        result = r;
        return r;
    });

    await vi.waitFor(async () => {
        const { data } = await ctx.store.listRuns({ agent: 'sweep' });
        expect(data[0]?.status).toBe('running');
    });
    controller.abort();
    // the drain timeout lives on the controllable clock
    await vi.waitFor(() => {
        ctx.clock.advance(DRAIN_MS);
        expect(result).toBeDefined();
    });
    return job;
}

describe('runJob with a signal', () => {
    it('caller cancellation during skill preparation preserves queued status and skips model execution', async () => {
        const entered = Promise.withResolvers<AbortSignal>();
        const release = Promise.withResolvers<void>();
        const ctx = setup([fakeSkillRuntime({
            prepare: async (signal) => {
                entered.resolve(signal);
                await release.promise;
                signal.throwIfAborted();
            },
        }).input]);
        const controller = new AbortController();
        const job = runJob({
            engine: ctx.engine,
            agent: ctx.agent,
            signal: controller.signal,
        });
        const signal = await entered.promise;
        controller.abort();
        expect(signal.aborted).toBe(true);
        release.resolve();
        await expect(job).resolves.toMatchObject({ status: 'queued', exitCode: 0 });
    });

    it('independent verification errors still reject when the caller also cancels', async () => {
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const failure = new Error('independent verification error');
        const ctx = setup([fakeSkillRuntime({
            prepare: async () => {
                entered.resolve();
                await release.promise;
                throw failure;
            },
        }).input]);
        const controller = new AbortController();
        const job = runJob({
            engine: ctx.engine,
            agent: ctx.agent,
            signal: controller.signal,
        });
        const rejection = expect(job).rejects.toBe(failure);
        await entered.promise;
        controller.abort();
        release.resolve();
        await rejection;
    });

    it('returns the stored status after the drain when aborted while waiting', async () => {
        const ctx = setup();

        const result = await abortWhileRunning(ctx);

        expect(result).toMatchObject({ status: 'interrupted', exitCode: 0 });
        const run = await ctx.store.getRun(result.runId as string);
        expect(run?.status).toBe('interrupted');
    });

    it('leaves no poll timer behind after the abort', async () => {
        const ctx = setup();
        const getRun = vi.spyOn(ctx.engine, 'getRun');

        await abortWhileRunning(ctx);
        const calls = getRun.mock.calls.length;
        ctx.clock.advance(10 * POLL_MS);
        await new Promise((resolve) => { setTimeout(resolve, 10); });

        expect(getRun.mock.calls.length).toBe(calls);
    });

    it('fires nothing and never starts the engine for an aborted signal', async () => {
        const ctx = setup();
        const listRuns = vi.spyOn(ctx.store, 'listRuns');
        const start = vi.spyOn(ctx.engine, 'start');
        const controller = new AbortController();
        controller.abort();

        const result = await runJob({
            engine: ctx.engine,
            agent: ctx.agent,
            signal: controller.signal,
        });

        expect(result).toEqual({ status: 'skipped', exitCode: 0 });
        expect(start).not.toHaveBeenCalled();
        expect(listRuns).not.toHaveBeenCalled();
        listRuns.mockRestore();
        const { total } = await ctx.store.listRuns({});
        expect(total).toBe(0);
    });

    it('an abort during the dispatch never starts the engine and answers the stored run', async () => {
        const ctx = setup();
        const controller = new AbortController();
        const dispatch = ctx.engine.dispatch.bind(ctx.engine);
        vi.spyOn(ctx.engine, 'dispatch').mockImplementation(async (envelope) => {
            const answer = await dispatch(envelope);
            controller.abort();
            return answer;
        });
        const start = vi.spyOn(ctx.engine, 'start');

        const result = await runJob({
            engine: ctx.engine,
            agent: ctx.agent,
            signal: controller.signal,
        });

        expect(start).not.toHaveBeenCalled();
        expect(result).toMatchObject({ status: 'queued', exitCode: 0 });
        expect(result.runId).toBeDefined();
    });

    it('an abort during engine.start skips the approval tick and the wait', async () => {
        const ctx = setup();
        const controller = new AbortController();
        const start = ctx.engine.start.bind(ctx.engine);
        vi.spyOn(ctx.engine, 'start').mockImplementation(async (options) => {
            controller.abort();
            await start(options);
        });
        const tick = vi.spyOn(ctx.engine, 'tick');
        let result: RunJobResult | undefined;
        const job = runJob({
            engine: ctx.engine,
            agent: ctx.agent,
            pollMs: POLL_MS,
            drainTimeoutMs: DRAIN_MS,
            signal: controller.signal,
        }).then((r) => {
            result = r;
            return r;
        });

        await vi.waitFor(() => {
            ctx.clock.advance(DRAIN_MS);
            expect(result).toBeDefined();
        });
        await job;

        expect(tick).not.toHaveBeenCalled();
        expect(result?.exitCode).toBe(0);
        expect(result?.runId).toBeDefined();
    });
});

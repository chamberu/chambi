/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
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
    FatalToolError,
    InvalidRunStateError,
    RunNotFoundError,
    ValidationError,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    AgentDefinition,
    EngineOptions,
    IEngine,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { recordApprovals } from '../../utils/approvals.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

const TIMEOUT = 60 * 60 * 1000;

const deployTurn = (env = 'prod', toolCallId?: string): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName: 'deploy',
        input: { env },
        toolCallId,
    }],
});

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

type Setup = {
    model: LanguageModel;
    /** Whether the deploy of `env` asks for an approval; default always. */
    gated?: (env: string) => boolean;
    budget?: AgentDefinition['budget'];
    /** Replaces the deploy tool's body (after recording the call). */
    deploy?: (input: { env: string }) => Promise<string>;
    engine?: Partial<EngineOptions>;
};

function setup(s: Setup) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const executed: unknown[] = [];
    const deploy = defineTool({
        inputSchema: z.object({ env: z.string() }),
        execute: async (input, { context }) => {
            if (s.gated?.(input.env) ?? true) {
                const decision = await approve(context, { title: `Deploy ${input.env}?`, timeoutMs: TIMEOUT });

                if (!decision.approved) {
                    return `not deployed: ${decision.reason ?? 'denied'}`;
                }
            }

            executed.push(input);

            if (s.deploy) {
                return s.deploy(input);
            }

            return `deployed ${input.env}`;
        },
    });
    const agent = defineAgent({
        name: 'release',
        instructions: 'You release.',
        model: s.model,
        tools: () => ({ deploy }),
        budget: s.budget,
    });
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        agents: [agent],
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
        ...s.engine,
    });

    engines.push(engine);

    const notifier = recordApprovals(engine);

    return {
        clock,
        store,
        notifier,
        executed,
        engine,
        errors,
    };
}

type Ctx = ReturnType<typeof setup>;

const env = (concurrencyKey?: string) => ({
    agent: 'release',
    trigger: 'http',
    channel: 'http' as const,
    payload: {},
    concurrencyKey,
});

async function dispatchToWaiting(ctx: Ctx, key?: string) {
    await ctx.engine.start();

    const { runId } = await ctx.engine.dispatch(env(key));

    await ctx.engine.idle();

    const run = await ctx.store.runs.findOne(runId);

    return { runId, run };
}

/** Advances past one poll interval (claimTtlMs/3) and waits until the engine settled. */
async function poll(ctx: Ctx, ms = 10) {
    ctx.clock.advance(ms);
    await ctx.engine.idle();
}

/** Answers the i-th approval the engine asked for, as the owner would. */
const answerOf = (ctx: Ctx, decision: { approved: boolean; reason?: string }, i = 0) => {
    const call = ctx.notifier.calls[i]!;

    return ctx.engine.approve(call.runId, { approvalId: call.approvalId, ...decision });
};

const promptOf = (model: ReturnType<typeof mockModel>, i: number) => JSON.stringify(model.doStreamCalls[i]?.prompt);

describe('approvals', () => {
    it('tool requiring approval puts run in waiting once', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);

        expect(run?.status).toBe('waiting');
        expect(run?.claim).toBeUndefined();
        expect(run?.finishedAt).toBeUndefined();
        expect(run?.waiting).toMatchObject({
            kind: 'approval',
            toolName: 'deploy',
            title: 'Deploy prod?',
            expiresAt: new Date(1_000_000 + TIMEOUT),
        });
        expect(ctx.executed).toEqual([]);

        const { approvalId } = run!.waiting!;

        expect(typeof approvalId).toBe('string');

        expect(ctx.notifier.calls).toHaveLength(1);

        // re-process the waiting run twice (as a crash recovery would): the pending call
        // suspends on the same approval again, without another model call or wait point
        for (let i = 0; i < 2; i++) {
            await ctx.store.runs.update(runId, { status: 'queued' }, { expectStatus: ['waiting'] });
            await poll(ctx);

            const again = await ctx.store.runs.findOne(runId);

            expect(again?.status).toBe('waiting');
            expect(again?.waiting).toEqual(run?.waiting);
        }

        expect(model.doStreamCalls).toHaveLength(1);
        expect(ctx.notifier.calls).toHaveLength(1);

        // the approval asked first still answers the run
        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('approved resume executes the tool and completes', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true, reason: 'go' });
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done?.status).toBe('completed');
        expect(done?.output).toBe('done');
        expect(done?.waiting).toBeUndefined();
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
        expect(promptOf(model, 1)).toContain('deployed prod');

        const { messages } = (await ctx.store.checkpoints.findOne(runId))!;

        // the tool result of the approved call is part of the checkpoint
        expect(JSON.stringify(messages)).toContain('deployed prod');

        const steps = await ctx.store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'wait', 'tool', 'llm']);
        expect(steps[1]).toMatchObject({
            name: 'deploy',
            input: { title: 'Deploy prod?' },
            output: {
                approvalId: run!.waiting!.approvalId,
                approved: true,
                reason: 'go',
            },
        });
        expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3]);
    });

    it('denied resume completes without deploying', async () => {
        const model = mockModel([deployTurn(), text('ok, not deploying')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: false, reason: 'not today' });
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done?.status).toBe('completed');
        expect(done?.output).toBe('ok, not deploying');
        expect(ctx.executed).toEqual([]);
        expect(promptOf(model, 1)).toContain('not today');
    });

    it('an answer is single-use', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true });
        await expect(answerOf(ctx, { approved: false })).rejects.toThrow(InvalidRunStateError);
        await ctx.engine.idle();
        await expect(answerOf(ctx, { approved: false })).rejects.toThrow(InvalidRunStateError);
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('racing answers: exactly one wins and only it records the decision', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);
        const put = vi.spyOn(ctx.store.effects, 'save');

        const results = await Promise.allSettled([
            answerOf(ctx, { approved: true }),
            answerOf(ctx, { approved: false }),
        ]);

        expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);

        const rejected = results.find((r) => r.status === 'rejected');

        expect(rejected?.reason).toBeInstanceOf(InvalidRunStateError);
        // only the winner's decision
        expect(put.mock.calls.filter(([key]) => key.startsWith('approval:'))).toHaveLength(1);
        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
    });

    it('an answered run is not picked up before its decision is recorded', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);
        const put = ctx.store.effects.save.bind(ctx.store.effects);

        // a poll pass runs while the answer records the decision
        vi.spyOn(ctx.store.effects, 'save').mockImplementationOnce(async (key, result) => {
            ctx.clock.advance(10);
            await ctx.engine.idle();
            expect((await ctx.store.runs.findOne(runId))?.status).toBe('queued');

            return put(key, result);
        });

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
        expect(model.doStreamCalls).toHaveLength(2);
    });

    it('a crash between the queued transition and the recorded decision keeps the approval answerable', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);

        // the answering process dies right after answer()'s waiting -> queued write
        vi.spyOn(ctx.store.effects, 'save').mockImplementationOnce(() => new Promise(() => {}));
        void answerOf(ctx, { approved: false });
        await vi.waitFor(async () => {
            expect((await ctx.store.runs.findOne(runId))?.status).toBe('queued');
        });

        const crashed = await ctx.store.runs.findOne(runId);

        expect(crashed?.claim).toBeDefined();
        // the wait point survives the transition
        expect(crashed?.waiting).toEqual(run?.waiting);

        // once the dead claim expired, the run is re-executed and pauses on the same wait point
        await poll(ctx, 40);

        const again = await ctx.store.runs.findOne(runId);

        expect(again?.status).toBe('waiting');
        expect(again?.waiting?.approvalId).toBe(run?.waiting?.approvalId);
        expect(again?.waiting?.expiresAt).toEqual(run?.waiting?.expiresAt);
        expect(model.doStreamCalls).toHaveLength(1);
        expect(ctx.notifier.calls).toHaveLength(1);

        // the owner's answer to the same approval still goes through
        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done).toMatchObject({ status: 'completed', output: 'done' });
        expect(done?.waiting).toBeUndefined();
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
    });

    it('tick does not answer a newer approval from a stale listing', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);

        ctx.engine.stop();

        const before = await ctx.store.checkpoints.findOne(runId);
        // a snapshot from before the run moved on to another (unexpired) approval
        const stale = {
            ...run!,
            waiting: {
                ...run!.waiting!,
                approvalId: 'older-approval',
                expiresAt: new Date(0),
            },
        };

        // stale listing: the re-read sees the current wait point and skips it
        vi.spyOn(ctx.store.runs, 'find').mockResolvedValueOnce({ data: [stale], total: 1 });
        await ctx.engine.tick();
        // stale listing and re-read: the transition sees another wait point and backs out
        vi.spyOn(ctx.store.runs, 'find').mockResolvedValueOnce({ data: [stale], total: 1 });
        vi.spyOn(ctx.store.runs, 'findOne').mockResolvedValueOnce(stale);
        await ctx.engine.tick();

        const current = await ctx.store.runs.findOne(runId);

        expect(current?.status).toBe('waiting');
        expect(current?.claim).toBeUndefined();
        expect(current?.waiting).toEqual(run?.waiting);
        expect(await ctx.store.checkpoints.findOne(runId)).toEqual(before);
        expect(ctx.errors).toEqual([]);

        await answerOf(ctx, { approved: true });
        await ctx.engine.start();
        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('an approval granted on the last allowed step still executes the tool', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model, budget: { maxSteps: 1 } });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();
        expect(ctx.executed).toEqual([{ env: 'prod' }]);
        expect(await ctx.store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
    });

    it('a resumed approval grants exactly one extra step', async () => {
        const model = mockModel([deployTurn(), deployTurn('dev'), text('never reached')]);
        const ctx = setup({
            model,
            budget: { maxSteps: 1 },
            gated: (target) => target !== 'dev',
        });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done?.status).toBe('failed');
        expect(done?.error).toEqual({ code: 'BudgetExceeded', message: 'The run reached its 1 step limit.' });
        expect(model.doStreamCalls).toHaveLength(2);
        expect(ctx.executed).toEqual([{ env: 'prod' }, { env: 'dev' }]);
    });

    it('an approval denied on the last allowed step still gets a wrap-up model call', async () => {
        const model = mockModel([deployTurn(), text('ok, skipped')]);
        const ctx = setup({ model, budget: { maxSteps: 1 } });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: false, reason: 'no' });
        await ctx.engine.idle();
        expect(ctx.executed).toEqual([]);
        expect(await ctx.store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'ok, skipped' });
    });

    it('a FatalToolError from an approved tool marks the run failed', async () => {
        const model = mockModel([deployTurn(), text('kept going')]);
        const ctx = setup({
            model,
            deploy: async () => {
                throw new FatalToolError('repository gone', 'RepoGone');
            },
        });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done?.status).toBe('failed');
        expect(done?.error).toEqual({ code: 'RepoGone', message: 'repository gone' });
        expect(done?.waiting).toBeUndefined();
        // no model call after the fatal tool
        expect(model.doStreamCalls).toHaveLength(1);

        const steps = await ctx.store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'wait', 'tool']);
        expect(steps[2]).toMatchObject({ name: 'deploy', error: { code: 'RepoGone', message: 'repository gone' } });
        expect(steps[2]?.output).toBeUndefined();
    });

    it('a plain error from an approved tool goes back to the model', async () => {
        const model = mockModel([deployTurn(), text('deploy failed, reported')]);
        const ctx = setup({
            model,
            deploy: async () => {
                throw new Error('flaky');
            },
        });
        const { runId } = await dispatchToWaiting(ctx);

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();
        expect(await ctx.store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'deploy failed, reported' });
        expect(promptOf(model, 1)).toContain('flaky');

        const steps = await ctx.store.steps.find(runId);

        expect(steps[2]).toMatchObject({ kind: 'tool', error: { code: 'Error', message: 'flaky' } });
    });

    it('tick denies expired approvals', async () => {
        const model = mockModel([deployTurn(), text('timed out, skipping')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);

        ctx.engine.stop();

        ctx.clock.advance(TIMEOUT - 1);
        await ctx.engine.tick();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('waiting');

        ctx.clock.advance(1);
        await ctx.engine.tick();
        await ctx.engine.start();
        await ctx.engine.idle();

        const done = await ctx.store.runs.findOne(runId);

        expect(done?.status).toBe('completed');
        expect(ctx.executed).toEqual([]);
        expect(promptOf(model, 1)).toContain('approval timed out');

        const steps = await ctx.store.steps.find(runId);

        expect(steps.find((s) => s.kind === 'wait')?.output).toMatchObject({ approved: false, reason: 'approval timed out' });
    });

    it('the poll loop expires approvals without a caller', async () => {
        const model = mockModel([deployTurn(), text('timed out')]);
        const ctx = setup({ model });
        const { runId } = await dispatchToWaiting(ctx);

        await poll(ctx, TIMEOUT);
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([]);
    });

    it('waiting run blocks its concurrencyKey', async () => {
        const model = mockModel([deployTurn(), text('a done'), text('b done')]);
        const ctx = setup({ model });
        const { runId: a } = await dispatchToWaiting(ctx, 'repo-1');
        const { runId: b } = await ctx.engine.dispatch(env('repo-1'));

        await ctx.engine.idle();
        await poll(ctx);
        expect((await ctx.store.runs.findOne(a))?.status).toBe('waiting');
        expect((await ctx.store.runs.findOne(b))?.status).toBe('queued');

        await answerOf(ctx, { approved: true });
        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(a))).toMatchObject({ status: 'completed', output: 'a done' });
        expect((await ctx.store.runs.findOne(b))).toMatchObject({ status: 'completed', output: 'b done' });
    });

    it('a waiting run frees its concurrency slot', async () => {
        const model = mockModel([deployTurn(), text('other done')]);
        const ctx = setup({ model, engine: { concurrencyMaxRuns: 1 } });

        await dispatchToWaiting(ctx);

        const { runId } = await ctx.engine.dispatch(env());

        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('a waiting run can be cancelled, which unblocks its key and voids the approval', async () => {
        const model = mockModel([deployTurn(), text('b done')]);
        const ctx = setup({ model });
        const { runId: a } = await dispatchToWaiting(ctx, 'repo-1');
        const { runId: b } = await ctx.engine.dispatch(env('repo-1'));

        await ctx.engine.idle();

        await ctx.engine.cancel(a);

        const cancelled = await ctx.store.runs.findOne(a);

        expect(cancelled).toMatchObject({ status: 'cancelled', waiting: undefined });
        await expect(answerOf(ctx, { approved: true })).rejects.toThrow(InvalidRunStateError);
        await poll(ctx);
        expect((await ctx.store.runs.findOne(b))?.status).toBe('completed');
        expect(ctx.executed).toEqual([]);
    });

    it('a cancel racing the pause settles the run cancelled', async () => {
        const ctx = setup({ model: mockModel([deployTurn()]) });
        const { promise: gate, resolve: open } = Promise.withResolvers<void>();
        let holding = false;
        const update = ctx.store.runs.update.bind(ctx.store.runs);

        vi.spyOn(ctx.store.runs, 'update').mockImplementation(async (id, patch, opts) => {
            if (patch.status === 'waiting') {
                holding = true;
                await gate;
            }

            return update(id, patch, opts);
        });
        await ctx.engine.start();

        const { runId } = await ctx.engine.dispatch(env());

        await vi.waitFor(() => expect(holding).toBe(true));

        // the abort cannot interrupt the waiting write already in flight
        const cancelled = ctx.engine.cancel(runId);

        open();
        await cancelled;
        await ctx.engine.idle();

        expect(await ctx.store.runs.findOne(runId)).toMatchObject({ status: 'cancelled', waiting: undefined });
        expect(ctx.errors).toEqual([]);
    });
});

describe('Engine.approve', () => {
    const approver = {
        id: 'u1',
        kind: 'authup',
        permissions: [],
    };

    it('approve answers the current wait point without a token', async () => {
        const model = mockModel([deployTurn(), text('done')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);
        const { approvalId } = run!.waiting!;

        await ctx.engine.approve(runId, {
            approvalId,
            approved: true,
            approver,
        });
        await ctx.engine.idle();

        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([{ env: 'prod' }]);

        const steps = await ctx.store.steps.find(runId);

        expect(steps.find((s) => s.kind === 'wait')?.output).toEqual({
            approvalId,
            approved: true,
            approver,
        });
    });

    it('approve denies with a reason', async () => {
        const model = mockModel([deployTurn(), text('ok')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);

        await ctx.engine.approve(runId, {
            approvalId: run!.waiting!.approvalId,
            approved: false,
            reason: 'no',
        });
        await ctx.engine.idle();

        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.executed).toEqual([]);
        expect(promptOf(model, 1)).toContain('no');
    });

    it('approve rejects a stale approvalId and leaves the run waiting', async () => {
        const ctx = setup({ model: mockModel([deployTurn(), text('done')]) });
        const { runId } = await dispatchToWaiting(ctx);
        const put = vi.spyOn(ctx.store.effects, 'save');

        await expect(ctx.engine.approve(runId, { approvalId: 'other', approved: true }))
            .rejects.toThrow(InvalidRunStateError);
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('waiting');
        expect(put).not.toHaveBeenCalled();
    });

    it('approve rejects an expired wait point', async () => {
        const model = mockModel([deployTurn(), text('timed out')]);
        const ctx = setup({ model });
        const { runId, run } = await dispatchToWaiting(ctx);
        const { approvalId } = run!.waiting!;

        ctx.engine.stop();
        ctx.clock.advance(TIMEOUT);

        await expect(ctx.engine.approve(runId, { approvalId, approved: true }))
            .rejects.toThrow(`Approval "${approvalId}" of run "${runId}" expired.`);
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('waiting');

        await ctx.engine.tick();

        const wait = (await ctx.store.steps.find(runId)).find((s) => s.kind === 'wait');

        expect(wait?.output).toMatchObject({ approved: false, reason: 'approval timed out' });
    });

    it('approve rejects a run that is not waiting', async () => {
        const ctx = setup({ model: mockModel([deployTurn(), text('done')]) });
        const { runId, run } = await dispatchToWaiting(ctx);
        const { approvalId } = run!.waiting!;

        await ctx.engine.approve(runId, { approvalId, approved: true });
        await ctx.engine.idle();

        await expect(ctx.engine.approve(runId, { approvalId, approved: true }))
            .rejects.toThrow(InvalidRunStateError);
    });

    it('approve of an unknown run throws RunNotFoundError', async () => {
        const ctx = setup({ model: mockModel([]) });

        await expect(ctx.engine.approve('nope', { approvalId: 'a', approved: true }))
            .rejects.toThrow(RunNotFoundError);
    });

    it('approve validates the approver before reading the store', async () => {
        const ctx = setup({ model: mockModel([]) });
        const getRun = vi.spyOn(ctx.store.runs, 'findOne');

        await expect(ctx.engine.approve('r1', {
            approvalId: 'a',
            approved: true,
            approver: {
                id: '',
                kind: 'x',
                permissions: [],
            },
        })).rejects.toThrow(ValidationError);
        expect(getRun).not.toHaveBeenCalled();
    });
});

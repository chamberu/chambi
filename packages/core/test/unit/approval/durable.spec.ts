/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { LanguageModel, ModelMessage, ToolSet } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidRunStateError,
    ToolDeniedError,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    AgentDefinition,
    ApprovalDecision,
    IChannel,
    IEngine,
    Invoker,
    ToolContext,
} from '@chamvi/core';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockPart, MockResponse } from '../../utils/mock-model.ts';

const DAY = 24 * 60 * 60 * 1000;
const START = 1_000_000;

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

const call = (toolName: string, input: unknown, toolCallId: string): MockPart => ({
    type: 'tool-call',
    toolName,
    input,
    toolCallId,
});
const turn = (...parts: MockPart[]): MockResponse => ({ parts });
const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

const approver: Invoker = {
    id: 'owner',
    kind: 'user',
    permissions: ['agent:release:approve'],
};

type Recorder = {
    /** Every deploy execution (also the replays), by env. */
    started: string[];
    /** Deploys that ran past their approval. */
    deployed: string[];
    decisions: ApprovalDecision[];
};

function createDeploy(recorder: Recorder, schema: z.ZodType = z.object({ env: z.string() })) {
    return defineTool({
        inputSchema: schema as z.ZodType<{ env: string }>,
        execute: async (input, { context }) => {
            recorder.started.push(input.env);

            const decision = await approve(context, { title: `Deploy ${input.env}?`, body: 'release 1.2' });

            recorder.decisions.push(decision);

            if (!decision.approved) {
                return `denied: ${decision.reason ?? ''}`;
            }

            recorder.deployed.push(input.env);

            return `deployed ${input.env}`;
        },
    });
}

function createEngine(
    store: ReturnType<typeof createMemoryStore>,
    clock: ControllableClock,
    model: LanguageModel,
    definition: Partial<AgentDefinition>,
    channels: IChannel[] = [],
) {
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'release',
            instructions: 'You release.',
            model,
            ...definition,
        })],
        channels,
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return { engine, errors };
}

function setup(model: LanguageModel, definition: Partial<AgentDefinition>) {
    const clock = new ControllableClock(new Date(START));
    const store = createMemoryStore({ clock });

    return {
        clock,
        store,
        ...createEngine(store, clock, model, definition),
    };
}

async function dispatch(engine: IEngine, store: ReturnType<typeof createMemoryStore>) {
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'release',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    await engine.idle();

    return { runId, run: await store.runs.findOne(runId) };
}

const newRecorder = (): Recorder => ({
    started: [],
    deployed: [],
    decisions: [],
});
const promptOf = (model: ReturnType<typeof mockModel>, i: number) => JSON.stringify(model.doStreamCalls[i]?.prompt);

function resultIds(messages: ModelMessage[]): string[] {
    const ids: string[] = [];

    for (const message of messages) {
        if (message.role !== 'tool') {
            continue;
        }

        for (const part of message.content) {
            if (part.type === 'tool-result') {
                ids.push(part.toolCallId);
            }
        }
    }

    return ids;
}

describe('durable approve()', () => {
    it('approve() pauses the run waiting with the wait point', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('done')]);
        const { store, engine } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.status).toBe('waiting');
        expect(run?.claim).toBeUndefined();
        expect(run?.waiting).toMatchObject({
            kind: 'approval',
            approvalId: '0:c1:0',
            toolCallId: 'c1',
            toolName: 'deploy',
            title: 'Deploy prod?',
            body: 'release 1.2',
            expiresAt: new Date(START + DAY),
        });
        expect(run?.waiting).not.toHaveProperty('input');
        expect(recorder.deployed).toEqual([]);

        // no tool step for the suspended call, and its result is not in the checkpoint
        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm']);

        const checkpoint = await store.checkpoints.findOne(runId);

        expect(JSON.stringify(checkpoint?.messages)).toContain('"toolCallId":"c1"');
        expect(resultIds(checkpoint!.messages)).toEqual([]);
    });

    it('approved: the call replays, approve() returns the decision, the model sees the tool result', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('done')]);
        const { store, engine } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId } = await dispatch(engine, store);

        await engine.approve(runId, {
            approvalId: '0:c1:0',
            approved: true,
            approver,
        });
        await engine.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        expect(model.doStreamCalls).toHaveLength(2);
        expect(recorder.started).toEqual(['prod', 'prod']);
        expect(recorder.decisions).toEqual([{ approved: true, approver }]);
        expect(recorder.deployed).toEqual(['prod']);
        expect(promptOf(model, 1)).toContain('deployed prod');

        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'wait', 'tool', 'llm']);
        expect(steps[1]).toMatchObject({
            name: 'deploy',
            output: {
                approvalId: '0:c1:0',
                approved: true,
                approver,
            },
        });
        expect(steps[2]).toMatchObject({
            name: 'deploy',
            input: { env: 'prod' },
            output: 'deployed prod',
        });

        const checkpoint = await store.checkpoints.findOne(runId);

        expect(resultIds(checkpoint!.messages)).toEqual(['c1']);
    });

    it('denied: approve() returns approved false with the reason', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('skipped')]);
        const { store, engine } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId } = await dispatch(engine, store);

        await engine.approve(runId, {
            approvalId: '0:c1:0',
            approved: false,
            reason: 'not today',
        });
        await engine.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'skipped' });
        expect(recorder.decisions).toEqual([{ approved: false, reason: 'not today' }]);
        expect(recorder.deployed).toEqual([]);
        expect(promptOf(model, 1)).toContain('denied: not today');
    });

    it('two parallel calls, one finishes and one suspends: the finished one does not run again', async () => {
        const recorder = newRecorder();
        let fast = 0;
        const quick = tool({
            inputSchema: z.object({}),
            execute: async () => {
                fast++;

                return 'quick done';
            },
        });
        const model = mockModel([
            turn(call('quick', {}, 'c1'), call('deploy', { env: 'prod' }, 'c2')),
            text('done'),
        ]);
        const { store, engine } = setup(model, { tools: { quick, deploy: createDeploy(recorder) } });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting?.approvalId).toBe('0:c2:0');
        expect(fast).toBe(1);
        expect((await store.steps.find(runId)).map((s) => s.name ?? s.kind)).toEqual(['mock-model-id', 'quick']);
        expect(resultIds((await store.checkpoints.findOne(runId))!.messages)).toEqual(['c1']);

        await engine.approve(runId, { approvalId: '0:c2:0', approved: true });
        await engine.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        expect(fast).toBe(1);
        expect(recorder.deployed).toEqual(['prod']);

        const prompt = promptOf(model, 1);

        expect(prompt).toContain('quick done');
        expect(prompt).toContain('deployed prod');
        expect(resultIds((await store.checkpoints.findOne(runId))!.messages).sort()).toEqual(['c1', 'c2']);
    });

    it('two suspending calls in one step pause one at a time, first in call order', async () => {
        const recorder = newRecorder();
        const model = mockModel([
            turn(call('deploy', { env: 'prod' }, 'c1'), call('deploy', { env: 'eu' }, 'c2')),
            text('both done'),
        ]);
        const { store, engine } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting).toMatchObject({ approvalId: '0:c1:0', title: 'Deploy prod?' });

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();

        const second = await store.runs.findOne(runId);

        expect(second?.status).toBe('waiting');
        expect(second?.waiting).toMatchObject({ approvalId: '0:c2:0', title: 'Deploy eu?' });
        expect(second?.waiting?.approvalId).not.toBe(run?.waiting?.approvalId);
        // paused again without a model call
        expect(model.doStreamCalls).toHaveLength(1);
        expect(recorder.deployed).toEqual(['prod']);
        expect(resultIds((await store.checkpoints.findOne(runId))!.messages)).toEqual(['c1']);

        await engine.approve(runId, { approvalId: '0:c2:0', approved: true });
        await engine.idle();
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'both done' });
        expect(recorder.deployed).toEqual(['prod', 'eu']);
        expect(model.doStreamCalls).toHaveLength(2);

        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'wait', 'tool', 'wait', 'tool', 'llm']);
    });

    it('a second approve() in the same call after the first was approved gets id <stepIndex>:<toolCallId>:1', async () => {
        const twice = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                const first = await approve(context, { title: 'first' });
                const second = await approve(context, { title: 'second' });

                return [first.approved, second.approved];
            },
        });
        const model = mockModel([turn(call('twice', {}, 'c1')), text('done')]);
        const { store, engine } = setup(model, { tools: { twice } });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting).toMatchObject({ approvalId: '0:c1:0', title: 'first' });

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();
        expect((await store.runs.findOne(runId))?.waiting).toMatchObject({ approvalId: '0:c1:1', title: 'second' });
        expect(model.doStreamCalls).toHaveLength(1);

        await engine.approve(runId, { approvalId: '0:c1:1', approved: false });
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools.map((s) => s.output)).toEqual([[true, false]]);
    });

    it('approve() inside beforeToolExecution gates a tool the agent did not write', async () => {
        const commands: string[] = [];
        const bash = tool({
            inputSchema: z.object({ command: z.string() }),
            execute: async ({ command }) => {
                commands.push(command);

                return `ran ${command}`;
            },
        });
        const model = mockModel([
            turn(call('bash', { command: 'ls' }, 'c1')),
            turn(call('bash', { command: 'rm -rf /' }, 'c2')),
            text('done'),
        ]);
        const { store, engine } = setup(model, {
            tools: { bash },
            hooks: {
                async beforeToolExecution(info, ctx) {
                    if (info.toolName !== 'bash') {
                        return info.input;
                    }

                    const { command } = info.input as { command: string };
                    const decision = await approve(ctx, { title: `Run ${command}?` });

                    if (!decision.approved) {
                        throw new ToolDeniedError(`bash refused: ${decision.reason ?? 'denied'}`);
                    }

                    return info.input;
                },
            },
        });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting).toMatchObject({
            approvalId: '0:c1:0',
            toolName: 'bash',
            title: 'Run ls?',
        });
        expect(commands).toEqual([]);

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();
        expect(commands).toEqual(['ls']);
        expect((await store.runs.findOne(runId))?.waiting).toMatchObject({ approvalId: '1:c2:0', title: 'Run rm -rf /?' });

        await engine.approve(runId, {
            approvalId: '1:c2:0',
            approved: false,
            reason: 'no',
        });
        await engine.idle();
        expect(commands).toEqual(['ls']);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools[1]).toMatchObject({ name: 'bash', error: { code: 'tool_denied', message: 'bash refused: no' } });
        expect(promptOf(model, 2)).toContain('bash refused: no');
    });

    it('a pending call whose tool the toolPolicy now refuses answers ToolNotAllowedError', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('not allowed, stopping')]);
        const {
            store,
            clock,
            engine,
        } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId } = await dispatch(engine, store);

        engine.stop();

        const { engine: tightened } = createEngine(store, clock, model, {
            tools: { deploy: createDeploy(recorder) },
            toolPolicy: () => false,
        });

        await tightened.approve(runId, { approvalId: '0:c1:0', approved: true });
        await tightened.start();
        await tightened.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'not allowed, stopping' });
        expect(recorder.started).toEqual(['prod']);

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools).toHaveLength(1);
        expect(tools[0]).toMatchObject({ name: 'deploy', error: { code: 'tool_not_allowed' } });
        expect(resultIds((await store.checkpoints.findOne(runId))!.messages)).toEqual(['c1']);
    });

    it('a pending call with an input that no longer parses is a ValidationError result', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('bad input')]);
        const {
            store,
            clock,
            engine,
        } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId } = await dispatch(engine, store);

        engine.stop();

        const { engine: changed } = createEngine(store, clock, model, { tools: { deploy: createDeploy(recorder, z.object({ env: z.number() })) } });

        await changed.approve(runId, { approvalId: '0:c1:0', approved: true });
        await changed.start();
        await changed.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'bad input' });
        expect(recorder.started).toEqual(['prod']);

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools[0]).toMatchObject({ name: 'deploy', error: { code: 'validation_error' } });
    });

    it('timeout: tick() past expiresAt denies with reason "approval timed out"', async () => {
        const decisions: ApprovalDecision[] = [];
        const deploy = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                const decision = await approve(context, { title: 'Deploy?', timeoutMs: 1000 });

                decisions.push(decision);

                return decision.approved ? 'deployed' : `denied: ${decision.reason}`;
            },
        });
        const model = mockModel([turn(call('deploy', {}, 'c1')), text('timed out')]);
        const {
            store,
            clock,
            engine,
        } = setup(model, { tools: { deploy } });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting?.expiresAt).toEqual(new Date(START + 1000));
        engine.stop();

        clock.advance(999);
        await engine.tick();
        expect((await store.runs.findOne(runId))?.status).toBe('waiting');
        clock.advance(1);
        await engine.tick();
        await engine.start();
        await engine.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'timed out' });
        expect(decisions).toEqual([{ approved: false, reason: 'approval timed out' }]);
        expect(promptOf(model, 1)).toContain('denied: approval timed out');
    });

    it('refuses a request without a title or with a timeout out of range', async () => {
        const seen: unknown[] = [];
        const ask = defineTool({
            inputSchema: z.object({ request: z.any() }),
            execute: async ({ request }, { context }) => {
                try {
                    await approve(context, request);
                } catch (error) {
                    seen.push((error as { code?: string }).code);
                }

                return 'ok';
            },
        });
        const model = mockModel([
            turn(
                call('ask', { request: { title: '' } }, 'c1'),
                call('ask', { request: { title: 'x', timeoutMs: 0 } }, 'c2'),
                call('ask', { request: { title: 'x', timeoutMs: 2 ** 31 } }, 'c3'),
            ),
            text('done'),
        ]);
        const { store, engine } = setup(model, { tools: { ask } });
        const { run } = await dispatch(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen).toEqual(['validation_error', 'validation_error', 'validation_error']);
    });

    it('approve() outside a tool call and inside a streaming tool body throw InvalidRunStateError', async () => {
        await expect(approve({ run: { runId: 'r1' } } as unknown as ToolContext, { title: 'x' }))
            .rejects.toThrow(InvalidRunStateError);

        const stream = defineTool({
            inputSchema: z.object({}),
            async* execute(_input, { context }) {
                yield 'started';
                await approve(context, { title: 'mid-stream' });
                yield 'never';
            },
        });
        const model = mockModel([turn(call('stream', {}, 'c1')), text('done')]);
        const { store, engine } = setup(model, { tools: { stream } as ToolSet });
        const { runId, run } = await dispatch(engine, store);

        expect(run).toMatchObject({ status: 'completed', output: 'done' });

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools[0]).toMatchObject({ name: 'stream', error: { code: 'invalid_run_state' } });
    });

    it('restart while waiting: a fresh Engine on the same memory store resumes from the stored pending checkpoint', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('done after restart')]);
        const {
            store,
            clock,
            engine,
        } = setup(model, { tools: { deploy: createDeploy(recorder) } });
        const { runId } = await dispatch(engine, store);

        engine.stop();

        const fresh = newRecorder();
        const { engine: restarted } = createEngine(store, clock, model, { tools: { deploy: createDeploy(fresh) } });

        await restarted.start();
        await restarted.approve(runId, { approvalId: '0:c1:0', approved: true });
        await restarted.idle();

        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done after restart' });
        expect(fresh.deployed).toEqual(['prod']);
        expect(fresh.decisions).toEqual([{ approved: true }]);
    });

    it('a resumed approval on the last allowed step still runs (one extra step)', async () => {
        const recorder = newRecorder();
        const model = mockModel([turn(call('deploy', { env: 'prod' }, 'c1')), text('done')]);
        const { store, engine } = setup(model, {
            tools: { deploy: createDeploy(recorder) },
            budget: { maxSteps: 1 },
        });
        const { runId } = await dispatch(engine, store);

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();
        expect(recorder.deployed).toEqual(['prod']);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
    });

    it('ChannelHandle.approve() records the channel and address on the wait point', async () => {
        const sent: unknown[] = [];
        const slack: IChannel = {
            name: 'slack',
            async out(message) {
                sent.push(message);
            },
        };
        const ask = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                const handle = context.channels.findOneOrFail('slack');
                const missing = await handle.approve({ title: 'no address' }).catch((error: { code?: string }) => error.code);
                const decision = await handle.approve({ title: 'Close #12?', address: 'C0OPS' });

                return [missing, decision.approved];
            },
        });
        const model = mockModel([turn(call('ask', {}, 'c1')), text('done')]);
        const clock = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        const { engine } = createEngine(store, clock, model, { tools: { ask } }, [slack]);
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting).toMatchObject({
            approvalId: '0:c1:0',
            title: 'Close #12?',
            channel: 'slack',
            address: 'C0OPS',
        });

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();

        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');

        expect(tools[0]?.output).toEqual(['validation_error', true]);
    });

    it('a pending third-party call whose contextSchema now rejects fails the run', async () => {
        let executed = 0;
        const third = tool({
            inputSchema: z.object({}),
            contextSchema: z.object({ token: z.string() }),
            execute: async () => {
                executed++;

                return 'ok';
            },
        });
        const model = mockModel([turn(call('third', {}, 'c1')), text('done')]);
        const hooks: AgentDefinition['hooks'] = {
            async beforeToolExecution(info, ctx) {
                await approve(ctx, { title: 'Run third?' });

                return info.input;
            },
        };
        const {
            store,
            clock,
            engine,
        } = setup(model, {
            tools: { third },
            toolsContext: { third: { token: 't' } },
            hooks,
        });
        const { runId, run } = await dispatch(engine, store);

        expect(run?.waiting?.approvalId).toBe('0:c1:0');
        engine.stop();

        const { engine: changed } = createEngine(store, clock, model, { tools: { third }, hooks });

        await changed.approve(runId, { approvalId: '0:c1:0', approved: true });
        await changed.start();
        await changed.idle();

        const failed = await store.runs.findOne(runId);

        expect(failed?.status).toBe('failed');
        expect(failed?.error).toMatchObject({ code: 'validation_error' });
        expect(failed?.error?.message).toContain('tool context (third)');
        expect(executed).toBe(0);
    });
});

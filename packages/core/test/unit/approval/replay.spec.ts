/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel, ToolSet } from 'ai';
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
    approve,
    defineAgent,
    defineEffectTool,
    defineTool,
} from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockPart, MockResponse } from '../../utils/mock-model.ts';

const START = 1_000_000;

const engines: Engine[] = [];

afterEach(async () => {
    await Promise.all(engines.map((e) => e.stop()));
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
const flush = () => new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
});

function createEngine(
    store: ReturnType<typeof createMemoryStore>,
    clock: ControllableClock,
    model: LanguageModel,
    tools: ToolSet,
    channels: IChannel[] = [],
) {
    const errors: unknown[] = [];
    const engine = new Engine({
        store,
        clock,
        claimTtlMs: 30,
        channels,
        agents: [defineAgent({
            name: 'release',
            instructions: 'You release.',
            model,
            tools,
        })],
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return { engine, errors };
}

async function dispatch(engine: Engine): Promise<string> {
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'release',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    return runId;
}

describe('approval replay', () => {
    it('a call id a provider reuses in a later step is another approval', async () => {
        const clock = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        const deployed: string[] = [];
        const deploy = defineTool({
            inputSchema: z.object({ env: z.string() }),
            execute: async ({ env }, { context }) => {
                const decision = await approve(context, { title: `Deploy ${env}?` });

                if (!decision.approved) {
                    return 'denied';
                }

                deployed.push(env);

                return `deployed ${env}`;
            },
        });
        const model = mockModel([
            turn(call('deploy', { env: 'staging' }, '0')),
            turn(call('deploy', { env: 'prod' }, '0')),
            text('done'),
        ]);
        const { engine } = createEngine(store, clock, model, { deploy });
        const runId = await dispatch(engine);

        await engine.idle();
        expect((await store.runs.findOne(runId))?.waiting).toMatchObject({ approvalId: '0:0:0', title: 'Deploy staging?' });

        await engine.approve(runId, { approvalId: '0:0:0', approved: true });
        await engine.idle();
        // the prod call of step 1 reuses the id '0' and still waits for its own answer
        expect(deployed).toEqual(['staging']);
        expect((await store.runs.findOne(runId))?.waiting).toMatchObject({ approvalId: '1:0:0', title: 'Deploy prod?' });

        await engine.approve(runId, { approvalId: '1:0:0', approved: true });
        await engine.idle();
        expect(deployed).toEqual(['staging', 'prod']);
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('a pending call that finished before a drain does not run again after recovery', async () => {
        const clock = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        const deployed: string[] = [];
        let hold = false;
        let release: (() => void) | undefined;
        const deploy = defineTool({
            inputSchema: z.object({ env: z.string() }),
            execute: async ({ env }, { context }) => {
                if (env === 'eu' && hold) {
                    const gate = Promise.withResolvers<void>();

                    release = gate.resolve;
                    await gate.promise;
                }

                const decision = await approve(context, { title: env });

                if (!decision.approved) {
                    return 'denied';
                }

                deployed.push(env);

                return `deployed ${env}`;
            },
        });
        const model = mockModel([
            turn(call('deploy', { env: 'prod' }, 'c1'), call('deploy', { env: 'eu' }, 'c2')),
            text('done'),
        ]);
        const first = createEngine(store, clock, model, { deploy });
        const runId = await dispatch(first.engine);

        await first.engine.idle();
        expect((await store.runs.findOne(runId))?.waiting?.approvalId).toBe('0:c1:0');

        hold = true;
        await first.engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        // c1 deployed and was recorded; c2's code before approve() hangs
        await vi.waitFor(() => expect(release).toBeDefined());
        expect(deployed).toEqual(['prod']);

        const drained = first.engine.drain({ timeoutMs: 10 });

        await flush();
        clock.advance(10);
        await drained;
        expect((await store.runs.findOne(runId))?.status).toBe('interrupted');

        const checkpoint = await store.checkpoints.findOne(runId);

        expect(JSON.stringify(checkpoint?.messages)).toContain('deployed prod');

        const toolSteps = (await store.steps.find(runId)).filter((step) => step.kind === 'tool');

        expect(toolSteps.map((step) => step.output)).toEqual(['deployed prod']);

        hold = false;
        release?.();
        clock.advance(100);

        const second = createEngine(store, clock, model, { deploy });

        await second.engine.start();
        await second.engine.idle();
        // only c2 replays: it asks for its own approval
        expect(deployed).toEqual(['prod']);
        expect((await store.runs.findOne(runId))?.waiting?.approvalId).toBe('0:c2:0');
        expect((await store.steps.find(runId)).filter((step) => step.kind === 'tool')).toHaveLength(1);
    });

    it('parallel identical effect calls that approve() both wait and share one application', async () => {
        const clock = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        let applied = 0;
        const post = defineEffectTool({
            inputSchema: z.object({ msg: z.string() }),
            execute: async ({ msg }, { context }) => {
                const decision = await approve(context, { title: `Post ${msg}?` });

                if (!decision.approved) {
                    return 'denied';
                }

                applied++;

                return 'posted';
            },
        });
        const model = mockModel([
            turn(call('post', { msg: 'hi' }, 'c1'), call('post', { msg: 'hi' }, 'c2')),
            text('done'),
        ]);
        const { engine } = createEngine(store, clock, model, { post });
        const runId = await dispatch(engine);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.waiting?.approvalId).toBe('0:c1:0');
        // neither call has a step or a result: both stay pending
        expect((await store.steps.find(runId)).map((step) => step.kind)).toEqual(['llm']);
        expect(JSON.stringify((await store.checkpoints.findOne(runId))?.messages)).not.toContain('suspended');

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();
        expect(applied).toBe(1);

        const tools = (await store.steps.find(runId)).filter((step) => step.kind === 'tool');

        expect(tools.map((step) => step.output)).toEqual(['posted', 'posted']);

        const prompt = JSON.stringify(model.doStreamCalls[1]?.prompt);

        expect(prompt).not.toContain('SuspendSignal');
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('a resume while a slow channel still delivers starts one execution that cancel reaches', async () => {
        const clock = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        const slack: IChannel = {
            name: 'slack',
            // hangs until the engine aborts the attempt
            out: (_message, _address, { signal }) => new Promise((_resolve, reject) => {
                signal.addEventListener('abort', () => reject(signal.reason), { once: true });
            }),
        };
        let resumed = 0;
        const deploy = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                await context.channels.findOneOrFail('slack').approve({ title: 'go?', address: 'C1' });
                resumed++;
                await new Promise((_resolve, reject) => {
                    context.run.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
                });
            },
        });
        const model = mockModel([turn(call('deploy', {}, 'c1')), text('done')]);
        const { engine } = createEngine(store, clock, model, { deploy }, [slack]);
        const runId = await dispatch(engine);

        await vi.waitFor(async () => expect((await store.runs.findOne(runId))?.status).toBe('waiting'));

        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await vi.waitFor(() => expect(resumed).toBe(1));
        // the delivery attempt times out meanwhile; the new execution keeps running
        clock.advance(30);
        await flush();
        expect((await store.runs.findOne(runId))?.status).toBe('running');

        await engine.cancel(runId);
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        expect(resumed).toBe(1);
    });
});

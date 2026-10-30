/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import { tool } from 'ai';
import type { LanguageModel, Tool, ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { Engine, FatalToolError, defineAgent } from '@chamvi/core';
import type { Budget, EngineOptions, IStore  } from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

/** Lets already-queued microtasks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

/** Holds the first call of `method` until `control.pending` is called. */
function createGatedStore(method: 'insert' | 'save') {
    const store = createMemoryStore();
    const control: { pending?: () => void; log: string[] } = { log: [] };
    let gated = false;
    const gate = async () => {
        if (gated) {
            return;
        }

        gated = true;
        await new Promise<void>((resolve) => {
            control.pending = resolve;
        });
    };
    const insert = store.steps.insert.bind(store.steps);

    vi.spyOn(store.steps, 'insert').mockImplementation(async (...args) => {
        if (method === 'insert') {
            await gate();
        }

        return insert(...args);
    });

    const save = store.checkpoints.save.bind(store.checkpoints);

    vi.spyOn(store.checkpoints, 'save').mockImplementation(async (...args) => {
        if (method === 'save') {
            await gate();
        }

        await save(...args);
        control.log.push('checkpoint');
    });

    return { control, store };
}

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

const lookup = (execute: () => Promise<unknown> = async () => 'found'): Tool => tool({
    inputSchema: z.object({ q: z.number().optional() }),
    execute,
});

type TestAgent = {
    model: LanguageModel;
    tools?: () => ToolSet;
    budget?: Partial<Budget>;
};

function make(def: TestAgent, opts: Partial<EngineOptions> & { store?: IStore } = {}) {
    const store = opts.store ?? createMemoryStore({ clock: opts.clock });
    const agent = defineAgent({
        name: 'triage',
        instructions: 'You triage.',
        model: def.model,
        tools: def.tools,
        budget: def.budget,
    });
    const engine = new Engine({
        store,
        agents: [agent],
        onError: () => {},
        ...opts,
    });

    engines.push(engine);

    return { store, engine };
}

const env = {
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: { issue: 42 },
};

const toolTurn = (input: unknown = { q: 1 }): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName: 'lookup',
        input,
    }],
});

/** A model whose calls only settle by aborting, to hold a run in `running`. */
function hangingModel() {
    const calls: LanguageModelV4CallOptions[] = [];
    const model = new MockLanguageModelV4({
        doStream: (options) => {
            calls.push(options);

            return new Promise((_resolve, reject) => {
                options.abortSignal?.addEventListener('abort', () => reject(options.abortSignal?.reason));
            });
        },
    });

    return { model, calls };
}

async function runOnce(def: Parameters<typeof make>[0], opts: Parameters<typeof make>[1] = {}) {
    const { engine, store } = make(def, opts);

    await engine.start();

    const { runId } = await engine.dispatch(env);

    await engine.idle();

    return {
        engine,
        store,
        runId,
        run: await store.runs.findOne(runId),
    };
}

const budget = (b: Partial<Budget>) => b;

describe('executeRun', () => {
    it('completed run stores output and usage', async () => {
        const {
            run,
            store,
            runId,
        } = await runOnce({
            model: mockModel([
                { ...toolTurn(), usage: { inputTokens: 3, outputTokens: 4 } },
                { parts: [{ type: 'text', text: 'done' }], usage: { inputTokens: 5, outputTokens: 6 } },
            ]),
            tools: () => ({ lookup: lookup() }),
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('done');
        expect(run?.usage).toEqual({ inputTokens: 8, outputTokens: 10 });
        expect(run?.error).toBeUndefined();
        expect(run?.claim).toBeUndefined();
        expect(await store.checkpoints.findOne(runId)).toMatchObject({ stepIndex: 1, finishReason: 'stop' });
    });

    it('usage is persisted after every step', async () => {
        const { engine } = make({
            model: mockModel([
                { ...toolTurn(), usage: { inputTokens: 3, outputTokens: 4 } },
                { parts: [{ type: 'text', text: 'done' }], usage: { inputTokens: 5, outputTokens: 6 } },
            ]),
            tools: () => ({ lookup: lookup() }),
        });
        const running: unknown[] = [];

        engine.on('run.updated', (e) => {
            if (e.type === 'run.updated' && e.run.status === 'running') {
                running.push(e.run.usage);
            }
        });
        await engine.start();
        await engine.dispatch(env);
        await engine.idle();
        expect(running).toEqual([
            { inputTokens: 0, outputTokens: 0 },
            { inputTokens: 3, outputTokens: 4 },
            { inputTokens: 8, outputTokens: 10 },
        ]);
    });

    it('starts from a user message rendering the trigger', async () => {
        const model = mockModel([{ parts: [{ type: 'text', text: 'ok' }] }]);

        await runOnce({ model });

        const prompt = JSON.stringify(model.doStreamCalls[0]?.prompt);

        expect(prompt).toContain('You triage.');
        expect(prompt).toContain('```json');
        expect(prompt).toContain('\\"issue\\": 42');
        expect(prompt).toContain('\\"channel\\": \\"http\\"');
    });

    it('checkpoint saved after every step', async () => {
        const store = createMemoryStore();
        const save = vi.spyOn(store.checkpoints, 'save');
        const appended: string[] = [];
        const { engine, runId } = await (async () => {
            const made = make({
                model: mockModel([
                    toolTurn(),
                    toolTurn(),
                    { parts: [{ type: 'text', text: 'done' }] },
                ]),
                tools: () => ({ lookup: lookup() }),
            }, { store });

            made.engine.on('step.appended', (e) => {
                if (e.type === 'step.appended') {
                    appended.push(e.step.kind);
                }
            });
            await made.engine.start();

            const dispatched = await made.engine.dispatch(env);

            await made.engine.idle();

            return { engine: made.engine, runId: dispatched.runId };
        })();

        expect((await engine.getRun(runId))?.status).toBe('completed');
        expect(save.mock.calls.map(([cp]) => cp.stepIndex)).toEqual([0, 1, 2]);
        // user, (assistant + tool) x 2, assistant
        expect(save.mock.calls.map(([cp]) => cp.messages.length)).toEqual([3, 5, 6]);

        const latest = await store.checkpoints.findOne(runId);

        expect(latest?.messages[0]?.role).toBe('user');
        expect(latest?.messages.at(-1)?.role).toBe('assistant');

        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'tool', 'llm', 'tool', 'llm']);
        expect(steps.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
        expect(steps[1]).toMatchObject({
            name: 'lookup',
            input: { q: 1 },
            output: 'found',
        });
        expect(appended).toEqual(['llm', 'tool', 'llm', 'tool', 'llm']);
    });

    it('run stops at maxSteps budget', async () => {
        const {
            run,
            store,
            runId,
        } = await runOnce({
            model: mockModel(Array.from({ length: 10 }, () => toolTurn())),
            tools: () => ({ lookup: lookup() }),
            budget: budget({ maxSteps: 3 }),
        });

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('BudgetExceeded');

        const steps = await store.steps.find(runId);

        expect(steps.filter((s) => s.kind === 'llm')).toHaveLength(3);
    });

    it('run stops at maxTokens budget', async () => {
        const {
            run,
            store,
            runId,
        } = await runOnce({
            model: mockModel(Array.from({ length: 10 }, () => ({ ...toolTurn(), usage: { inputTokens: 10, outputTokens: 10 } }))),
            tools: () => ({ lookup: lookup() }),
            budget: budget({ maxSteps: 10, maxTokens: 50 }),
        });

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('BudgetExceeded');
        expect((await store.steps.find(runId)).filter((s) => s.kind === 'llm')).toHaveLength(3);
    });

    it('a final answer at the step limit completes', async () => {
        const { run } = await runOnce({
            model: mockModel([toolTurn(), { parts: [{ type: 'text', text: 'done' }] }]),
            tools: () => ({ lookup: lookup() }),
            budget: budget({ maxSteps: 2 }),
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('done');
    });

    it('run times out', async () => {
        const clock = new ControllableClock(new Date('2026-01-01T00:00:00Z'));
        const { model, calls } = hangingModel();
        const { engine, store } = make({ model, budget: budget({ timeoutMs: 50 }) }, { clock });

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        clock.advance(49);
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect((await store.runs.findOne(runId))?.status).toBe('running');
        clock.advance(1);
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('Timeout');
    });

    it('cancel aborts a running run', async () => {
        const { model, calls } = hangingModel();
        const { engine, store } = make({ model });
        const statuses: string[] = [];

        engine.on('run.updated', (e) => {
            if (e.type === 'run.updated') {
                statuses.push(e.run.status);
            }
        });
        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(calls).toHaveLength(1));
        await engine.cancel(runId);

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('cancelled');
        expect(run?.claim).toBeUndefined();
        expect(run?.finishedAt).toBeInstanceOf(Date);
        expect(calls[0]?.abortSignal?.aborted).toBe(true);
        expect(statuses.at(-1)).toBe('cancelled');
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
    });

    it('cancel marks a queued run cancelled', async () => {
        const model = mockModel([]);
        const { engine, store } = make({ model });
        const { runId } = await engine.dispatch(env);

        await engine.cancel(runId);
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        await engine.start();
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('cancel rejects unknown and settled runs', async () => {
        const { engine } = make({ model: mockModel([{ parts: [{ type: 'text', text: 'ok' }] }]) });

        await expect(engine.cancel('nope')).rejects.toMatchObject({ code: 'run_not_found' });
        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();
        await expect(engine.cancel(runId)).rejects.toMatchObject({ code: 'invalid_run_state' });
    });

    it('tool error is fed back to the model', async () => {
        const model = mockModel([toolTurn(), { parts: [{ type: 'text', text: 'recovered' }] }]);
        const {
            run,
            store,
            runId,
        } = await runOnce({
            model,
            tools: () => ({
                lookup: lookup(async () => {
                    throw Object.assign(new Error('kaput'), { code: 'tool_broke' });
                }),
            }),
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('recovered');
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('kaput');

        const steps = await store.steps.find(runId);

        expect(steps.map((s) => s.kind)).toEqual(['llm', 'tool', 'llm']);
        expect(steps[1]?.error).toEqual({ code: 'tool_broke', message: 'kaput' });
    });

    it('FatalToolError marks run failed', async () => {
        const model = mockModel([toolTurn(), { parts: [{ type: 'text', text: 'never' }] }]);
        const { run } = await runOnce({
            model,
            tools: () => ({
                lookup: lookup(async () => {
                    throw new FatalToolError('repository gone', 'RepoGone');
                }),
            }),
        });

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'RepoGone', message: 'repository gone' });
        expect(model.doStreamCalls).toHaveLength(1);
    });

    it.each(['insert', 'save'] as const)('a cancel while %s is pending keeps the step whole and writes nothing after', async (method) => {
        const gate = createGatedStore(method);
        const { engine } = make({
            model: mockModel([toolTurn(), { parts: [{ type: 'text', text: 'late' }] }]),
            tools: () => ({ lookup: lookup() }),
        }, { store: gate.store });
        const events = gate.control.log;

        engine.on('run.updated', (e) => {
            if (e.type === 'run.updated') {
                events.push(`run:${e.run.status}`);
            }
        });
        engine.on('step.appended', (e) => {
            if (e.type === 'step.appended') {
                events.push(`step:${e.step.kind}`);
            }
        });
        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(gate.control.pending).toBeDefined());

        const cancelled = engine.cancel(runId);

        await flush();
        gate.control.pending?.();
        await cancelled;
        await engine.idle();

        const steps = (await gate.store.steps.find(runId)).map((s) => s.kind);
        const checkpoint = await gate.store.checkpoints.findOne(runId);

        // let the abandoned generate run on
        for (let i = 0; i < 10; i++) {
            await flush();
        }

        expect((await gate.store.runs.findOne(runId))?.status).toBe('cancelled');
        // the completed step lands with its tool row and checkpoint before the run settles
        expect(steps).toEqual(['llm', 'tool']);
        expect(checkpoint?.stepIndex).toBe(0);
        expect((await gate.store.steps.find(runId)).map((s) => s.kind)).toEqual(steps);
        expect((await gate.store.checkpoints.findOne(runId))?.stepIndex).toBe(checkpoint?.stepIndex);
        expect(events.at(-1)).toBe('run:cancelled');
        expect(events.filter((e) => e === 'run:cancelled')).toHaveLength(1);
    });

    it.each([
        ['stop', 'completed'],
        ['tool-calls', 'failed'],
    ])('resuming at the step limit after a %s step settles %s', async (finishReason, status) => {
        const store = createMemoryStore();
        const model = mockModel([]);
        const { engine } = make({ model, budget: budget({ maxSteps: 2 }) }, { store });
        const { runId } = await engine.dispatch(env);

        await store.checkpoints.save({
            runId,
            stepIndex: 1,
            messages: [
                { role: 'user', content: 'q' },
                { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
            ],
            finishReason,
            createdAt: new Date(),
        });
        await engine.start();
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe(status);

        if (status === 'completed') {
            expect(run?.output).toBe('final answer');
        } else {
            expect(run?.error?.code).toBe('BudgetExceeded');
        }

        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('model error marks run failed', async () => {
        const { run } = await runOnce({ model: mockModel([]) });

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'mock script exhausted' });
    });

    it('execution resumes from checkpoint messages', async () => {
        const store = createMemoryStore();
        const model = mockModel([{ parts: [{ type: 'text', text: 'resumed' }] }]);
        const { engine } = make({ model }, { store });
        const { runId } = await engine.dispatch(env);

        await store.checkpoints.save({
            runId,
            stepIndex: 0,
            messages: [
                { role: 'user', content: 'seeded question' },
                { role: 'assistant', content: [{ type: 'text', text: 'seeded answer' }] },
                { role: 'user', content: 'go on' },
            ],
            createdAt: new Date(),
        });
        await engine.start();
        await engine.idle();

        const prompt = model.doStreamCalls[0]?.prompt ?? [];

        expect(prompt.filter((m) => m.role !== 'system')).toEqual([
            { role: 'user', content: [{ type: 'text', text: 'seeded question' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'seeded answer' }] },
            { role: 'user', content: [{ type: 'text', text: 'go on' }] },
        ]);
        expect((await store.runs.findOne(runId))?.output).toBe('resumed');

        const latest = await store.checkpoints.findOne(runId);

        expect(latest?.stepIndex).toBe(1);
        expect(latest?.messages).toHaveLength(4);
    });
});

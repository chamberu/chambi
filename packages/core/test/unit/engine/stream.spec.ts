/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModelV4CallOptions, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { simulateReadableStream, tool } from 'ai';
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
import { Engine, defineAgent } from '@chamvi/core';
import type { RunDelta } from '@chamvi/core';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
    vi.restoreAllMocks();
});

const env = {
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: { issue: 42 },
};

function make(model: LanguageModel, tools?: () => ToolSet) {
    const store = createMemoryStore();
    const agent = defineAgent({
        name: 'triage',
        instructions: 'You triage.',
        model,
        tools,
    });
    const engine = new Engine({
        store,
        agents: [agent],
        onError: () => {},
    });

    engines.push(engine);

    const deltas: RunDelta[] = [];

    engine.on('run.delta', (e) => {
        deltas.push(e.delta);
    });

    return {
        store,
        engine,
        deltas,
    };
}

const lookup = () => ({
    lookup: tool({
        inputSchema: z.object({ q: z.number() }),
        execute: async () => 'found',
    }),
});

const usage = {
    inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: undefined,
        cacheWrite: undefined,
    },
    outputTokens: {
        total: 1,
        text: 1,
        reasoning: undefined,
    },
};

/** A model that streams `chunks` once (stream-start and finish added). */
function chunkModel(chunks: LanguageModelV4StreamPart[]) {
    return new MockLanguageModelV4({
        doStream: async () => ({
            stream: simulateReadableStream({
                chunks: [
                    { type: 'stream-start', warnings: [] },
                    ...chunks,
                    {
                        type: 'finish',
                        finishReason: { unified: 'stop', raw: undefined },
                        usage,
                    },
                ],
            }),
        }),
    });
}

/** A model that streams `turns[n]` as is on call n (stream-start added, no finish). */
function rawModel(turns: LanguageModelV4StreamPart[][]) {
    let turn = 0;

    return new MockLanguageModelV4({
        doStream: async () => {
            const chunks = turns[turn++];

            if (!chunks) {
                throw new Error('mock script exhausted');
            }

            return { stream: simulateReadableStream({ chunks: [{ type: 'stream-start', warnings: [] }, ...chunks] }) };
        },
    });
}

const textChunks = (text: string): LanguageModelV4StreamPart[] => [
    { type: 'text-start', id: 't' },
    {
        type: 'text-delta',
        id: 't',
        delta: text,
    },
    { type: 'text-end', id: 't' },
];

const finishChunk = (unified: 'stop' | 'other', raw?: string): LanguageModelV4StreamPart => ({
    type: 'finish',
    finishReason: { unified, raw },
    usage,
});

describe('streaming', () => {
    it('emits text deltas in order with the step they are saved under', async () => {
        const model = mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'lookup',
                    input: { q: 1 },
                }],
            },
            { parts: [{ type: 'text', text: 'Hel' }, { type: 'text', text: 'lo' }] },
        ]);
        const {
            engine,
            store,
            deltas,
        } = make(model, lookup);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect(deltas).toEqual([
            {
                runId,
                step: 1,
                kind: 'text',
                text: 'Hel',
            },
            {
                runId,
                step: 1,
                kind: 'text',
                text: 'lo',
            },
        ]);

        const llm = (await store.steps.find(runId)).filter((s) => s.kind === 'llm');
        const stored = llm.at(-1)?.output as { text: string };

        expect(deltas.map((d) => d.text).join('')).toBe(stored.text);
        expect((await store.checkpoints.findOne(runId))?.stepIndex).toBe(1);
    });

    it('emits reasoning deltas', async () => {
        const model = chunkModel([
            { type: 'reasoning-start', id: 'r' },
            {
                type: 'reasoning-delta',
                id: 'r',
                delta: 'think',
            },
            { type: 'reasoning-end', id: 'r' },
            { type: 'text-start', id: 't' },
            {
                type: 'text-delta',
                id: 't',
                delta: 'answer',
            },
            { type: 'text-end', id: 't' },
        ]);
        const {
            engine,
            store,
            deltas,
        } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        expect((await store.runs.findOne(runId))?.output).toBe('answer');
        expect(deltas.map((d) => [d.step, d.kind, d.text])).toEqual([
            [0, 'reasoning', 'think'],
            [0, 'text', 'answer'],
        ]);
    });

    it('emits no delta after a cancel settled the run', async () => {
        const calls: LanguageModelV4CallOptions[] = [];
        let push: ((part: LanguageModelV4StreamPart) => void) | undefined;
        const model = new MockLanguageModelV4({
            doStream: async (options) => {
                calls.push(options);

                const stream = new ReadableStream<LanguageModelV4StreamPart>({
                    start(controller) {
                        controller.enqueue({ type: 'stream-start', warnings: [] });
                        controller.enqueue({ type: 'text-start', id: 't' });
                        push = (part) => {
                            // the AI SDK may have cancelled the stream on abort
                            try {
                                controller.enqueue(part);
                            } catch {
                                // closed
                            }
                        };
                    },
                });

                return { stream };
            },
        });
        const {
            engine,
            store,
            deltas,
        } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(push).toBeDefined());
        push?.({
            type: 'text-delta',
            id: 't',
            delta: 'early',
        });
        await vi.waitFor(() => expect(deltas).toHaveLength(1));

        await engine.cancel(runId);
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        push?.({
            type: 'text-delta',
            id: 't',
            delta: 'late',
        });
        await engine.idle();
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });

        expect(deltas.map((d) => d.text)).toEqual(['early']);
        expect(calls[0]?.abortSignal?.aborted).toBe(true);
    });

    it('an error mid-stream fails the run with that error', async () => {
        const model = chunkModel([
            { type: 'text-start', id: 't' },
            {
                type: 'text-delta',
                id: 't',
                delta: 'partial',
            },
            { type: 'error', error: new Error('boom') },
        ]);
        const { engine, store } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'boom' });
    });

    it('a failed model call leaves an llm step with finish reason error and a checkpoint', async () => {
        const model = rawModel([[
            { type: 'text-start', id: 't' },
            {
                type: 'text-delta',
                id: 't',
                delta: 'partial',
            },
            { type: 'error', error: new Error('boom') },
        ]]);
        const { engine, store } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'boom' });

        const steps = await store.steps.find(runId);

        expect(steps.map((step) => step.kind)).toEqual(['llm']);
        expect(steps[0]?.output).toMatchObject({ text: 'partial', finishReason: 'error' });
        expect(await store.checkpoints.findOne(runId)).toMatchObject({ stepIndex: 0, finishReason: 'error' });
    });

    it('a model error after a completed step fails the run', async () => {
        const model = mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'lookup',
                input: { q: 1 },
            }],
        }]);
        const { engine, store } = make(model, lookup);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'mock script exhausted' });
        expect((await store.checkpoints.findOne(runId))?.stepIndex).toBe(0);
    });

    it('a model error is not logged by the AI SDK', async () => {
        // onError is passed untyped to streamText; a dependency bump that stops forwarding it fails here
        const log = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { engine, store } = make(mockModel([]));

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'mock script exhausted' });
        expect(log).not.toHaveBeenCalled();
    });

    it('fails a run whose model stream ends without a finish part after text', async () => {
        const model = rawModel([textChunks('partial')]);
        const { engine, store } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('incomplete_response');
        expect(run?.error?.message).toMatch(/without a finish/);
        expect(run?.output).toBeUndefined();
    });

    it('fails a run whose model stream ends without a finish part after a tool call', async () => {
        let executed = 0;
        const model = rawModel([
            [{
                type: 'tool-call',
                toolCallId: 'c1',
                toolName: 'lookup',
                input: JSON.stringify({ q: 1 }),
            }],
            [...textChunks('done'), finishChunk('stop')],
        ]);
        const { engine, store } = make(model, () => ({
            lookup: tool({
                inputSchema: z.object({ q: z.number() }),
                execute: async () => {
                    executed++;

                    return 'found';
                },
            }),
        }));

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('incomplete_response');
        expect(executed).toBe(0);
        expect(model.doStreamCalls).toHaveLength(1);
    });

    it.each([
        ['with a raw reason', 'provider_specific'],
        ['without a raw reason', undefined],
    ])('completes a run whose model reports finish reason other %s', async (_, raw) => {
        const model = rawModel([[...textChunks('answer'), finishChunk('other', raw)]]);
        const { engine, store } = make(model);

        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('answer');
    });

    it('aborts the model stream when consuming it throws', async () => {
        const calls: LanguageModelV4CallOptions[] = [];
        let push: ((part: LanguageModelV4StreamPart) => void) | undefined;
        const model = new MockLanguageModelV4({
            doStream: async (options) => {
                calls.push(options);

                const stream = new ReadableStream<LanguageModelV4StreamPart>({
                    start(controller) {
                        controller.enqueue({ type: 'stream-start', warnings: [] });
                        controller.enqueue({ type: 'text-start', id: 't' });
                        push = (part) => {
                            try {
                                controller.enqueue(part);
                            } catch {
                                // closed
                            }
                        };
                    },
                });

                return { stream };
            },
        });
        const store = createMemoryStore();
        const engine = new Engine({
            store,
            agents: [defineAgent({
                name: 'triage',
                instructions: 'You triage.',
                model,
            })],
            // a throwing error sink makes the listener failure escape emit
            onError: () => {
                throw new Error('sink failed');
            },
        });

        engines.push(engine);
        engine.on('run.delta', () => {
            throw new Error('listener failed');
        });
        await engine.start();

        const { runId } = await engine.dispatch(env);

        await vi.waitFor(() => expect(push).toBeDefined());
        push?.({
            type: 'text-delta',
            id: 't',
            delta: 'x',
        });
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error).toEqual({ code: 'Error', message: 'sink failed' });
        expect(calls[0]?.abortSignal?.aborted).toBe(true);
    });
});

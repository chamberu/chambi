/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { Output, simulateReadableStream, tool } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import type { RunDelta } from '@chamvi/core';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { z } from 'zod';
import { Engine, defineAgent } from '@chamvi/core';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

const env = {
    agent: 'triage',
    trigger: 'http',
    channel: 'http' as const,
    payload: { issue: 42 },
};

const output = Output.object({ schema: z.object({ label: z.enum(['bug', 'feature']) }) });

function make(model: LanguageModel, opts: {
    tools?: () => ToolSet;
    maxSteps?: number;
    output?: typeof output
} = {}) {
    const store = createMemoryStore();
    const agent = defineAgent({
        name: 'triage',
        instructions: 'You triage.',
        model,
        tools: opts.tools,
        output: 'output' in opts ? opts.output : output,
        ...(opts.maxSteps ? { budget: { maxSteps: opts.maxSteps } } : {}),
    });
    const engine = new Engine({
        store,
        agents: [agent],
        onError: () => {},
    });

    engines.push(engine);

    return { store, engine };
}

async function runOnce(model: LanguageModel, opts: Parameters<typeof make>[1] = {}) {
    const { engine, store } = make(model, opts);

    await engine.start();

    const { runId } = await engine.dispatch(env);

    await engine.idle();

    return store.runs.findOne(runId);
}

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

/** A model answering `t` once, finishing with reason 'length' (cut at its output token limit). */
function cutModel(t: string) {
    return new MockLanguageModelV4({
        doStream: async () => ({
            stream: simulateReadableStream<LanguageModelV4StreamPart>({
                chunks: [
                    { type: 'stream-start', warnings: [] },
                    { type: 'text-start', id: 't' },
                    {
                        type: 'text-delta',
                        id: 't',
                        delta: t,
                    },
                    { type: 'text-end', id: 't' },
                    {
                        type: 'finish',
                        finishReason: { unified: 'length', raw: 'max_tokens' },
                        usage: {
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
                        },
                    },
                ],
            }),
        }),
    });
}

describe('structured output', () => {
    it('stores the parsed object as the run output', async () => {
        const run = await runOnce(mockModel([text('{"label":"bug"}')]));

        expect(run?.status).toBe('completed');
        expect(run?.output).toEqual({ label: 'bug' });
    });

    it('parses the final answer after tool calls', async () => {
        const run = await runOnce(mockModel([
            {
                parts: [{
                    type: 'tool-call',
                    toolName: 'lookup',
                    input: { q: 1 },
                }],
            },
            text('{"label":"feature"}'),
        ]), {
            tools: () => ({
                lookup: tool({
                    inputSchema: z.object({ q: z.number() }),
                    execute: async () => 'found',
                }),
            }),
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toEqual({ label: 'feature' });
    });

    it('fails with a validation error on invalid JSON', async () => {
        const run = await runOnce(mockModel([text('not json')]));

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('validation_error');
        expect(run?.error?.message).toMatch(/could not parse/);
        // the cause names the offending text
        expect(run?.error?.message).toMatch(/not json/);
    });

    it('fails with a validation error on a schema mismatch', async () => {
        const run = await runOnce(mockModel([text('{"label":"other"}')]));

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('validation_error');
        expect(run?.error?.message).toMatch(/did not match schema/);
        // the cause names the offending field
        expect(run?.error?.message).toMatch(/"path":\s*\[\s*"label"\s*\]/);
    });

    it('plain agents keep the text output', async () => {
        const run = await runOnce(mockModel([text('{"label":"bug"}')]), { output: undefined });

        expect(run?.output).toBe('{"label":"bug"}');
    });

    it.each([
        ['{"label":"bug"}', 'completed'],
        ['oops', 'failed'],
    ])('parses the answer of an earlier execution at the step limit (%s)', async (answer, status) => {
        const model = mockModel([]);
        const { engine, store } = make(model, { maxSteps: 2 });
        const { runId } = await engine.dispatch(env);

        await store.checkpoints.save({
            runId,
            stepIndex: 1,
            messages: [
                { role: 'user', content: 'q' },
                { role: 'assistant', content: [{ type: 'text', text: answer }] },
            ],
            finishReason: 'stop',
            createdAt: new Date(),
        });
        await engine.start();
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe(status);

        if (status === 'completed') {
            expect(run?.output).toEqual({ label: 'bug' });
        } else {
            expect(run?.error?.code).toBe('validation_error');
        }

        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('fails naming the tool when the loop ends on a call nothing executed', async () => {
        const run = await runOnce(mockModel([{
            parts: [{
                type: 'tool-call',
                toolName: 'handoff',
                input: { to: 'human' },
            }],
        }]), {
            // no execute: the AI SDK ends the loop on the call
            tools: () => ({ handoff: tool({ inputSchema: z.object({ to: z.string() }) }) }),
        });

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('incomplete_response');
        expect(run?.error?.message).toMatch(/"handoff"/);
        expect(run?.error?.message).not.toMatch(/could not parse/);
    });

    it('keeps completing a plain agent whose loop ends on a call nothing executed', async () => {
        const run = await runOnce(mockModel([{
            parts: [{ type: 'text', text: 'handing off' }, {
                type: 'tool-call',
                toolName: 'handoff',
                input: { to: 'human' },
            }],
        }]), {
            tools: () => ({ handoff: tool({ inputSchema: z.object({ to: z.string() }) }) }),
            output: undefined,
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('handing off');
    });

    it('fails saying the answer was cut off on finish reason length', async () => {
        const run = await runOnce(cutModel('{"label":"bu'));

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('incomplete_response');
        expect(run?.error?.message).toMatch(/cut off/);
        expect(run?.error?.message).toMatch(/length/);
    });

    it('keeps the cut text of a plain agent on finish reason length', async () => {
        const run = await runOnce(cutModel('{"label":"bu'), { output: undefined });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('{"label":"bu');
    });

    it('fails an earlier execution\'s cut answer at the step limit as incomplete', async () => {
        const model = mockModel([]);
        const { engine, store } = make(model, { maxSteps: 1 });
        const { runId } = await engine.dispatch(env);

        await store.checkpoints.save({
            runId,
            stepIndex: 0,
            messages: [
                { role: 'user', content: 'q' },
                { role: 'assistant', content: [{ type: 'text', text: '{"label":"bu' }] },
            ],
            finishReason: 'length',
            createdAt: new Date(),
        });
        await engine.start();
        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('incomplete_response');
        expect(model.doStreamCalls).toHaveLength(0);
    });

    it('bounds the answer quoted in a validation error', async () => {
        const answer = 'x'.repeat(5000);
        const run = await runOnce(mockModel([text(answer)]));

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('validation_error');
        expect(run?.error?.message).toMatch(/could not parse/);
        expect(run?.error?.message).toMatch(/x…$/);
        expect(run?.error?.message.length).toBeLessThan(600);
    });

    it('does not parse partial output while streaming, but emits every delta', async () => {
        let partialParses = 0;
        const counted: typeof output = {
            ...output,
            parsePartialOutput: async (options) => {
                partialParses++;

                return output.parsePartialOutput(options);
            },
        };
        const pieces = ['{"label":', '"bu', 'g"', '}'];
        const model = new MockLanguageModelV4({
            doStream: async () => ({
                stream: simulateReadableStream<LanguageModelV4StreamPart>({
                    chunks: [
                        { type: 'stream-start', warnings: [] },
                        { type: 'text-start', id: 't' },
                        ...pieces.map((delta): LanguageModelV4StreamPart => ({
                            type: 'text-delta',
                            id: 't',
                            delta,
                        })),
                        { type: 'text-end', id: 't' },
                        {
                            type: 'finish',
                            finishReason: { unified: 'stop', raw: undefined },
                            usage: {
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
                            },
                        },
                    ],
                }),
            }),
        });
        const { engine, store } = make(model, { output: counted });
        const deltas: RunDelta[] = [];

        engine.on('run.delta', (e) => {
            deltas.push(e.delta);
        });
        await engine.start();

        const { runId } = await engine.dispatch(env);

        await engine.idle();

        const run = await store.runs.findOne(runId);

        expect(run?.status).toBe('completed');
        expect(run?.output).toEqual({ label: 'bug' });
        expect(partialParses).toBe(0);
        expect(deltas.map((d) => d.text)).toEqual(pieces);
    });
});

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { ModelMessage } from 'ai';
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
    ErrorCode,
    approve,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { AgentDefinition, AgentInstructions } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(async () => {
    const stopping = engines.map((engine) => engine.stop());

    engines.length = 0;
    await Promise.all(stopping);
    vi.unstubAllGlobals();
});

const text: MockResponse = { parts: [{ type: 'text', text: 'done' }] };
const call: MockResponse = {
    parts: [{
        type: 'tool-call',
        toolName: 'lookup',
        toolCallId: 'real-call',
        input: {},
    }],
};
const envelope = {
    agent: 'test',
    channel: 'test',
    trigger: 'test',
    payload: {},
};

function setup(
    instructions: AgentInstructions,
    responses: MockResponse[] = [text],
    extra: Partial<AgentDefinition> = {},
    store = createMemoryStore(),
) {
    const model = mockModel(responses);
    const engine = new Engine({
        store,
        model,
        agents: [defineAgent({
            name: 'test',
            instructions,
            ...extra,
        })],
        onError: () => {},
    });

    engines.push(engine);

    return {
        model,
        engine,
        store,
    };
}
async function run(ctx: ReturnType<typeof setup>) {
    await ctx.engine.start();

    const { runId } = await ctx.engine.dispatch(envelope);

    await ctx.engine.idle();

    return runId;
}

const examples: AgentInstructions = Object.freeze([
    Object.freeze({
        role: 'system',
        content: 'base',
        providerOptions: { test: { cache: true } },
    }),
    Object.freeze({ role: 'system', content: 'policy' }),
    Object.freeze({ role: 'user', content: 'example question' }),
    Object.freeze({ role: 'system', content: 'interleaved policy' }),
    Object.freeze({ role: 'assistant', content: 'example answer' }),
]);

describe('structured instructions', () => {
    it.each(['legacy role', '', []] satisfies AgentInstructions[])('retains string and empty-array compatibility: %j', async (instructions) => {
        const ctx = setup(instructions);
        const runId = await run(ctx);

        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('preserves native assistant multipart content and message/part provider options', async () => {
        const message: AgentInstructions = [{
            role: 'assistant',
            providerOptions: { test: { message: true } },
            content: [
                {
                    type: 'reasoning',
                    text: 'example reasoning',
                    providerOptions: { test: { reasoning: true } },
                },
                {
                    type: 'text',
                    text: 'example answer',
                    providerOptions: { test: { text: true } },
                },
                {
                    type: 'file',
                    mediaType: 'text/plain',
                    data: new Uint8Array([65]),
                    providerOptions: { test: { file: true } },
                },
            ],
        }];
        const ctx = setup(message);
        const runId = await run(ctx);

        expect((await ctx.store.runs.findOne(runId))?.status).toBe('completed');
        expect(ctx.model.doStreamCalls[0]?.prompt[0]).toMatchObject({
            role: 'assistant',
            providerOptions: { test: { message: true } },
            content: [
                {
                    type: 'reasoning',
                    text: 'example reasoning',
                    providerOptions: { test: { reasoning: true } },
                },
                {
                    type: 'text',
                    text: 'example answer',
                    providerOptions: { test: { text: true } },
                },
                {
                    type: 'file',
                    mediaType: 'text/plain',
                    data: { type: 'data', data: new Uint8Array([65]) },
                    providerOptions: { test: { file: true } },
                },
            ],
        });
    });

    it('preserves ordered native roles and options once per model step, outside checkpoints', async () => {
        const ctx = setup(examples, [call, text], { tools: { lookup: tool({ inputSchema: z.object({}), execute: async () => 'found' }) } });
        const runId = await run(ctx);

        expect(await ctx.store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        expect(ctx.model.doStreamCalls).toHaveLength(2);

        for (const options of ctx.model.doStreamCalls) {
            expect(options.prompt.slice(0, 5)).toEqual([
                {
                    role: 'system',
                    content: 'base',
                    providerOptions: { test: { cache: true } },
                },
                { role: 'system', content: 'policy' },
                { role: 'user', content: [{ type: 'text', text: 'example question' }] },
                { role: 'system', content: 'interleaved policy' },
                { role: 'assistant', content: [{ type: 'text', text: 'example answer' }] },
            ]);
            expect(JSON.stringify(options.prompt).match(/example question/g)).toHaveLength(1);
        }

        const checkpoint = await ctx.store.checkpoints.findOne(runId);

        expect(checkpoint?.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
        expect(JSON.stringify(checkpoint)).not.toContain('example');
        expect(examples[0]?.providerOptions).toEqual({ test: { cache: true } });
    });

    it('passes multipart bytes, URLs and native provider options without mutating caller values', async () => {
        const bytes = new Uint8Array([1, 2, 3]);
        const url = new URL('https://example.com/example.pdf');
        const content = Object.freeze([
            Object.freeze({
                type: 'text' as const,
                text: 'inspect',
                providerOptions: { test: { part: true } },
            }),
            Object.freeze({
                type: 'image' as const,
                image: bytes,
                mediaType: 'image/png',
            }),
            Object.freeze({
                type: 'file' as const,
                data: url,
                mediaType: 'application/pdf',
            }),
        ] as const);
        // Native SDK content arrays are mutable types; freeze after assigning them.
        const user: ModelMessage = {
            role: 'user',
            content: [...content],
            providerOptions: { test: { message: true } },
        };

        Object.freeze(user.content); Object.freeze(user);
        vi.stubGlobal('AI_SDK_LOG_WARNINGS', false);

        const ctx = setup(Object.freeze([user]));

        vi.spyOn(ctx.model, 'supportedUrls', 'get').mockReturnValue(Promise.resolve({ 'application/pdf': [/^https:/] }));

        const runId = await run(ctx);

        expect((await ctx.store.runs.findOne(runId))?.status, JSON.stringify((await ctx.store.runs.findOne(runId))?.error)).toBe('completed');
        expect(ctx.model.doStreamCalls[0]?.prompt[0]).toMatchObject({
            role: 'user',
            providerOptions: { test: { message: true } },
            content: [
                {
                    type: 'text',
                    text: 'inspect',
                    providerOptions: { test: { part: true } },
                },
                {
                    type: 'file',
                    data: { type: 'data', data: bytes },
                    mediaType: 'image/png',
                },
                {
                    type: 'file',
                    data: { type: 'url', url },
                    mediaType: 'application/pdf',
                },
            ],
        });
        expect(user.content).toEqual(content);
        expect(content[1]?.image).toBe(bytes);
        expect(content[2]?.data).toBe(url);
    });

    it('rebuilds a hydrated transient prefix on fresh-engine approval replay with matching tool context', async () => {
        const store = createMemoryStore();

        await store.artifacts.insert({
            id: 'example-file',
            runId: 'fixture',
            agent: 'test',
            mediaType: 'text/plain',
            size: 3,
            createdAt: new Date(),
        }, new Uint8Array([97, 98, 99]));

        const instructions: AgentInstructions = [
            { role: 'system', content: 'base' },
            {
                role: 'user',
                content: [{
                    type: 'file',
                    mediaType: 'text/plain',
                    data: 'chamvi-artifact:example-file',
                }],
            },
            { role: 'system', content: 'later policy' },
            {
                role: 'assistant',
                content: [{
                    type: 'tool-call',
                    toolName: 'lookup',
                    toolCallId: 'example-call',
                    input: {},
                    providerExecuted: true,
                }],
            },
        ];
        const contexts: ModelMessage[][] = [];
        const lookup = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, options) => {
                contexts.push(options.messages);
                await approve(options.context, { title: 'Continue?' });

                return 'found';
            },
        });
        const first = setup(instructions, [call], { tools: { lookup } }, store);
        const runId = await run(first);
        const waiting = await store.runs.findOne(runId);

        expect(waiting?.status, JSON.stringify(waiting?.error)).toBe('waiting');
        await first.engine.stop();
        expect(JSON.stringify(await store.checkpoints.findOne(runId))).not.toContain('example-file');

        const second = setup(instructions, [text], { tools: { lookup } }, store);

        await second.engine.start();
        await second.engine.approve(runId, { approvalId: waiting!.waiting!.approvalId, approved: true });
        await second.engine.idle();
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'done' });
        expect(contexts).toHaveLength(2);
        expect(contexts[1]?.slice(0, 3)).toEqual(contexts[0]?.slice(0, 3));
        expect(contexts[1]?.[0]).toMatchObject({ role: 'user', content: [{ data: new Uint8Array([97, 98, 99]) }] });

        const { prompt } = (second.model.doStreamCalls[0]!);

        expect(prompt.slice(0, 4).map((message) => message.role)).toEqual(['system', 'user', 'system', 'assistant']);
        expect(JSON.stringify(prompt).match(/example-call/g)).toHaveLength(1);
        expect(JSON.stringify(await store.checkpoints.findOne(runId))).not.toMatch(/example-call|example-file|later policy/);
        expect(instructions[1]).toMatchObject({ content: [{ data: 'chamvi-artifact:example-file' }] });
    });

    it('hydrates prefix file markers on later model steps and fails missing artifacts before tools or model', async () => {
        const store = createMemoryStore();

        await store.artifacts.insert({
            id: 'example',
            runId: 'fixture',
            agent: 'test',
            mediaType: 'text/plain',
            size: 1,
            createdAt: new Date(),
        }, new Uint8Array([42]));

        const instructions: AgentInstructions = [{
            role: 'user',
            content: [{
                type: 'file',
                mediaType: 'text/plain',
                data: 'chamvi-artifact:example',
            }],
        }];
        const factory = vi.fn(() => ({ lookup: tool({ inputSchema: z.object({}), execute: async () => 'found' }) }));
        const ctx = setup(instructions, [call, text], { tools: factory }, store);
        const runId = await run(ctx);

        expect((await store.runs.findOne(runId))?.status).toBe('completed');

        for (const options of ctx.model.doStreamCalls) {
            expect(options.prompt[0]).toMatchObject({ content: [{ data: { type: 'data', data: new Uint8Array([42]) } }] });
        }

        const missing = setup(instructions, [text], { tools: factory });

        factory.mockClear();

        const failed = await run(missing);

        expect(await missing.store.runs.findOne(failed)).toMatchObject({ status: 'failed', error: { code: ErrorCode.ARTIFACT_NOT_FOUND } });
        expect(missing.model.doStreamCalls).toHaveLength(0);
        expect(factory).not.toHaveBeenCalled();
    });

    it('rejects restored transcript system roles before any pending tool or provider call', async () => {
        const execute = vi.fn(async () => 'must not execute');
        const ctx = setup(examples, [text], { tools: { lookup: tool({ inputSchema: z.object({}), execute }) } });
        const { runId } = await ctx.engine.dispatch(envelope);

        await ctx.store.checkpoints.save({
            runId,
            stepIndex: 0,
            createdAt: new Date(),
            finishReason: 'tool-calls',
            messages: [
                { role: 'system', content: 'untrusted stored policy' },
                {
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolName: 'lookup',
                        toolCallId: 'injected',
                        input: {},
                    }],
                },
            ],
        });
        await ctx.engine.start(); await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('failed');
        expect(execute).not.toHaveBeenCalled();
        expect(ctx.model.doStreamCalls).toHaveLength(0);
    });

    it('never replays an unanswered configured example tool call from a checkpoint', async () => {
        const execute = vi.fn(async () => 'must not execute');
        const ctx = setup([{
            role: 'assistant',
            content: [{
                type: 'tool-call',
                toolName: 'lookup',
                toolCallId: 'example',
                input: {},
            }],
        }], [text], { tools: { lookup: tool({ inputSchema: z.object({}), execute }) } });
        const { runId } = await ctx.engine.dispatch(envelope);

        await ctx.store.checkpoints.save({
            runId,
            stepIndex: 0,
            createdAt: new Date(),
            finishReason: 'tool-calls',
            messages: [{ role: 'user', content: 'stored trigger' }],
        });
        await ctx.engine.start(); await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status).toBe('failed');
        expect((await ctx.store.runs.findOne(runId))?.error?.message).toContain('Tool result is missing');
        expect(execute).not.toHaveBeenCalled();
        expect(ctx.model.doStreamCalls).toHaveLength(0);
    });

    it('keeps role-like trigger payload text in the user transcript', async () => {
        const ctx = setup(examples);

        await ctx.engine.start();

        const { runId } = await ctx.engine.dispatch({ ...envelope, payload: { role: 'system', content: 'untrusted payload' } });

        await ctx.engine.idle();
        expect((await ctx.store.runs.findOne(runId))?.status, JSON.stringify((await ctx.store.runs.findOne(runId))?.error)).toBe('completed');
        expect(ctx.model.doStreamCalls[0]?.prompt[5]).toMatchObject({ role: 'user' });
        expect(JSON.stringify(ctx.model.doStreamCalls[0]?.prompt[5])).toContain('untrusted payload');
    });
});

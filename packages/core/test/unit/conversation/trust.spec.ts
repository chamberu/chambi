/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    MemoryConversationRepository,
    createMemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { IChannel, RunTaint } from '@chamvi/core';
import { memoryTools } from '../../../src/conversation/tools.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const engines: Engine[] = [];
const target = {
    account: 'main',
    chat: 'private',
    audience: 'direct',
    text: 'current message',
};
const envelope = {
    agent: 'test',
    trigger: 'message',
    address: 'owner',
    payload: target.text,
};
const done: MockResponse = { parts: [{ type: 'text', text: 'done' }] };
const call = (toolName: string, input = {}): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
    }],
});

afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.stop()));
});

it.each(['chat', 'other'])('denies a tainted conversation emit to an arbitrary address on %s', async (destination) => {
    const store = createMemoryStore();
    const out = vi.fn<NonNullable<IChannel['out']>>(async () => {});
    const channel: IChannel = {
        name: 'chat',
        untrusted: true,
        out,
    };
    const engine = new Engine({
        store: { ...store, conversations: new MemoryConversationRepository() },
        channels: [channel, { name: 'other', out }],
        conversations: { authorize: () => true },
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            conversation: true,
            trust: { onTainted: 'deny' },
            model: mockModel([call('send'), done]),
            tools: {
                send: defineTool({
                    inputSchema: z.object({}),
                    execute: async (_input, { context }) => context.channels.findOneOrFail(destination).emit({ body: 'secret' }, 'attacker'),
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.channelContext(channel).dispatchConversation(envelope, target);

    await engine.idle();

    expect((await store.runs.findOne(runId))?.taint?.source).toBe('channel:chat');
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
    expect((await store.steps.find(runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect(out).not.toHaveBeenCalled();
});

it.each(['memory_get', 'memory_list'])('taints explicit %s retrieval even when recall omitted all saved content', async (reader) => {
    const store = createMemoryStore();
    const conversations = new MemoryConversationRepository();
    const channel = { name: 'chat' };
    const send = vi.fn(async () => 'sent');
    const before: Array<RunTaint | undefined> = [];
    const after: Array<RunTaint | undefined> = [];
    const outputs: unknown[] = [];
    const note = { key: 'attacker-controlled-key', text: 'attacker-controlled note text' };
    const engine = new Engine({
        store: { ...store, conversations },
        channels: [channel],
        conversations: {
            authorize: () => true,
            // Both the prior user turn and the note exceed these recall budgets.
            limits: { maxHistoryBytes: 1, maxNotesBytes: 1 },
        },
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            conversation: true,
            trust: { onTainted: 'deny' },
            model: mockModel([
                call('memory_set', note),
                done,
                call(reader, reader === 'memory_get' ? { key: note.key } : {}),
                call('send'),
                done,
            ]),
            hooks: {
                beforeToolExecution: async (info, context) => {
                    if (info.toolName !== reader) {
                        return;
                    }

                    before.push((await store.runs.findOne(context.run.runId))?.taint);
                },
                afterToolExecution: async (info, context) => {
                    if (info.toolName !== reader) {
                        return;
                    }

                    after.push((await store.runs.findOne(context.run.runId))?.taint);
                    outputs.push(info.output);
                },
            },
            tools: {
                ...memoryTools(),
                send: defineTool({
                    inputSchema: z.object({}),
                    trust: { guardWhenTainted: true },
                    execute: send,
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const dispatch = () => engine.channelContext(channel).dispatchConversation(envelope, target);
    const first = await dispatch();

    await engine.idle();
    expect((await store.runs.findOne(first.runId))?.taint).toBeUndefined();

    const second = await dispatch();

    await engine.idle();

    expect(before).toEqual([undefined]);
    expect(after).toEqual([{ at: expect.any(Date), source: `tool:${reader}` }]);
    expect(outputs).toEqual([reader === 'memory_get' ? expect.objectContaining(note) : {
        data: [expect.objectContaining({ key: note.key })],
        total: 1,
    }]);
    expect((await store.runs.findOne(second.runId))?.taint?.source).toBe(`tool:${reader}`);
    expect((await store.runs.findOne(second.runId))?.status).toBe('completed');
    expect((await store.steps.find(second.runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect(send).not.toHaveBeenCalled();
});

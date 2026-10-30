/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
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
    agentChannel,
    createMemoryStore,
    defineAgent,
    defineEffectTool,
    defineTool,
    handoff,
    startHandoff,
} from '@chamvi/core';
import type { AgentDefinition, RunTaint, ToolContext } from '@chamvi/core';
import { createRunArtifacts } from '../../../src/artifact/module.ts';
import { systemClock } from '../../../src/clock/index.ts';
import { wrapToolsForRun } from '../../../src/effect/wrap.ts';
import { createAgentState } from '../../../src/state/module.ts';
import { bindTrust } from '../../../src/trust/module.ts';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];
const call = (toolName: string, input = {}) => ({
    parts: [{
        type: 'tool-call' as const,
        toolName,
        toolCallId: toolName,
        input,
    }],
});
const done = { parts: [{ type: 'text' as const, text: 'done' }] };
const envelope = {
    agent: 'test',
    channel: 'test',
    trigger: 'test',
    payload: {},
};

afterEach(async () => {
    await Promise.all(engines.splice(0).map((engine) => engine.stop()));
    vi.restoreAllMocks();
});

function setup(definition: Omit<AgentDefinition, 'name' | 'instructions'>, store = createMemoryStore()) {
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            ...definition,
        })],
    });

    engines.push(engine);

    return { engine, store };
}

it.each(['generator', 'iterable factory'] as const)('persists taint before a streaming %s yields its first SDK-visible value', async (kind) => {
    const store = createMemoryStore();
    const context: ToolContext = {
        run: {
            runId: 'stream-test',
            agent: 'test',
            trigger: {
                ...envelope,
                id: 'trigger',
                receivedAt: new Date(),
            },
            signal: new AbortController().signal,
        },
        channels: {
            find: () => [],
            findOne: () => undefined,
            findOneOrFail: () => {
                throw new Error('No channel');
            },
        },
        state: createAgentState('test', undefined, store.state),
        artifacts: createRunArtifacts(store.artifacts, { id: 'stream-test', agent: 'test' }, systemClock),
    };
    const writing = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const persisted: RunTaint[] = [];

    bindTrust(context.run, {
        now: () => new Date('2026-10-30T12:00:00Z'),
        persist: async (taint) => {
            writing.resolve();
            await release.promise;
            persisted.push(taint);
        },
    });

    async function* chunks() {
        yield 'first untrusted chunk';
        yield 'last untrusted chunk';
    }

    const reader = defineTool({
        inputSchema: z.object({}),
        trust: { untrustedResult: true },
        execute: kind === 'generator' ? chunks : () => chunks(),
    });
    const wrapped = wrapToolsForRun({ reader }, context, store.effects);
    const result = wrapped.reader!.execute!({}, {
        toolCallId: 'read',
        messages: [],
        context,
    });
    let visible = false;
    const first = (async () => {
        const output = await result;
        const iterator = typeof output === 'string' ? undefined : (output as AsyncIterable<string>)[Symbol.asyncIterator]();
        const value = iterator ? await iterator.next() : output;

        visible = true;
        expect(persisted).toEqual([{ at: new Date('2026-10-30T12:00:00Z'), source: 'tool:reader' }]);

        return { value, iterator };
    })();

    await writing.promise;

    try {
        expect(visible).toBe(false);
        expect(persisted).toEqual([]);
    } finally {
        release.resolve();
    }

    const { value, iterator } = await first;

    if (kind === 'generator') {
        expect(value).toEqual({ value: 'first untrusted chunk', done: false });
        expect(await iterator!.next()).toEqual({ value: 'last untrusted chunk', done: false });
        expect(await iterator!.next()).toEqual({ value: undefined, done: true });
    } else {
        expect(value).toBe('last untrusted chunk');
    }

    expect(persisted).toHaveLength(1);
});

it('taints a streaming Engine reader before its result hook and denies the next outbound call', async () => {
    const observed: Array<RunTaint | undefined> = [];
    const send = vi.fn(async () => 'sent');
    const store = createMemoryStore();
    const { engine } = setup({
        trust: { onTainted: 'deny' },
        model: mockModel([call('reader'), call('send'), done]),
        tools: {
            reader: defineTool({
                inputSchema: z.object({}),
                trust: { untrustedResult: true },
                async *execute () {
                    yield 'first';
                    yield 'last';
                },
            }),
            send: defineEffectTool({
                inputSchema: z.object({}),
                trust: { outbound: true },
                execute: send,
            }),
        },
        hooks: {
            afterToolExecution: async ({ toolName }, context) => {
                if (toolName === 'reader') {
                    observed.push((await store.runs.findOne(context.run.runId))?.taint);
                }
            },
        },
    }, store);

    await engine.start();

    const { runId } = await engine.dispatch(envelope);

    await engine.idle();

    expect(observed).toHaveLength(1);
    expect(observed.every((taint) => taint?.source === 'tool:reader')).toBe(true);
    expect(send).not.toHaveBeenCalled();
    expect((await store.steps.find(runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
});

it.each(['cached', 'reconciled'] as const)('taints %s untrusted effect results even when execute is skipped', async (kind) => {
    const store = createMemoryStore();
    const execute = vi.fn(async () => 'fresh external text');
    const reconcile = vi.fn(async () => 'recovered external text');
    const send = vi.fn(async () => 'sent');

    if (kind === 'cached') {
        await store.effects.save('external-read', 'cached external text');
    }

    const { engine } = setup({
        trust: { onTainted: 'deny' },
        model: mockModel([call('reader'), call('send'), done]),
        tools: {
            reader: defineEffectTool({
                inputSchema: z.object({}),
                effectKey: () => 'external-read',
                alreadyApplied: reconcile,
                trust: { untrustedResult: true },
                execute,
            }),
            send: defineEffectTool({
                inputSchema: z.object({}),
                trust: { outbound: true },
                execute: send,
            }),
        },
    }, store);

    await engine.start();

    const { runId } = await engine.dispatch(envelope);

    await engine.idle();

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledTimes(kind === 'cached' ? 0 : 1);
    expect((await store.runs.findOne(runId))?.taint).toMatchObject({ source: 'tool:reader' });
    expect(send).not.toHaveBeenCalled();
    expect((await store.steps.find(runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
});

it('shares the first taint persistence across parallel readers and retains its source', async () => {
    const store = createMemoryStore();
    const writing = Promise.withResolvers<void>();
    const bothClassified = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const taints: RunTaint[] = [];
    const update = store.runs.update.bind(store.runs);
    let classifications = 0;

    vi.spyOn(store.runs, 'update').mockImplementation(async (id, patch, options) => {
        if (patch.taint) {
            taints.push(patch.taint);
            writing.resolve();
            await release.promise;
        }

        return update(id, patch, options);
    });

    const reader = () => defineTool({
        inputSchema: z.object({}),
        trust: {
            untrustedResult: () => {
                classifications++;

                if (classifications === 2) {
                    bothClassified.resolve();
                }

                return true;
            },
        },
        execute: async () => 'external text',
    });
    const send = vi.fn(async () => 'sent');
    const { engine } = setup({
        trust: { onTainted: 'deny' },
        model: mockModel([
            { parts: [...call('first').parts, ...call('second').parts] },
            call('send'),
            done,
        ]),
        tools: {
            first: reader(),
            second: reader(),
            send: defineEffectTool({
                inputSchema: z.object({}),
                trust: { outbound: true },
                execute: send,
            }),
        },
    }, store);

    await engine.start();

    const { runId } = await engine.dispatch(envelope);

    await Promise.all([writing.promise, bothClassified.promise]);

    try {
        expect(taints).toHaveLength(1);
        expect((await store.runs.findOne(runId))?.taint).toBeUndefined();
    } finally {
        release.resolve();
    }

    await engine.idle();

    expect(taints).toHaveLength(1);
    expect(taints[0]?.source).toBe('tool:first');
    expect((await store.runs.findOne(runId))?.taint).toEqual(taints[0]);
    expect(send).not.toHaveBeenCalled();
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
});

it('applies agent trust overrides to foreign tools without replacing their own context', async () => {
    const context = { token: 'foreign-token' };
    const seen: unknown[] = [];
    const send = vi.fn(async () => 'sent');
    const { engine, store } = setup({
        trust: {
            onTainted: 'deny',
            tools: { foreign: { untrustedResult: true }, send: { outbound: true } },
        },
        model: mockModel([call('foreign'), call('send'), done]),
        toolsContext: { foreign: context, send: context },
        tools: {
            foreign: tool({
                inputSchema: z.object({}),
                contextSchema: z.object({ token: z.string() }),
                execute: async (_input, options) => {
                    seen.push(options.context);

                    return 'foreign untrusted text';
                },
            }),
            send: tool({
                inputSchema: z.object({}),
                contextSchema: z.object({ token: z.string() }),
                execute: send,
            }),
        },
    });

    await engine.start();

    const { runId } = await engine.dispatch(envelope);

    await engine.idle();

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual(context);
    expect((await store.runs.findOne(runId))?.taint).toMatchObject({ source: 'tool:foreign' });
    expect(send).not.toHaveBeenCalled();
    expect((await store.steps.find(runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
});

it('inherits a tainted parent into a handoff run and blocks child outbound effects', async () => {
    const parentModel = mockModel([call('reader'), call('fan'), done]);
    const childModel = mockModel([call('send'), done]);
    const send = vi.fn(async () => 'sent');
    const store = createMemoryStore();
    const agent = defineAgent({
        name: 'test',
        instructions: 'test',
        channels: [handoff.on()],
        trust: { onTainted: 'deny' },
        model: new MockLanguageModelV4({
            doStream: (options) => {
                const first = options.prompt.find((message) => message.role === 'user');
                const child = first && typeof first.content !== 'string' &&
                    first.content.some((part) => part.type === 'text' && part.text.includes('"channel": "agent"'));

                return (child ? childModel : parentModel).doStream(options);
            },
        }),
        tools: {
            reader: defineTool({
                inputSchema: z.object({}),
                trust: { untrustedResult: true },
                execute: async () => 'external text',
            }),
            fan: defineTool({ inputSchema: z.object({}), execute: async (_input, { context }) => startHandoff(context, { payload: 'child task' }) }),
            send: defineEffectTool({
                inputSchema: z.object({}),
                trust: { outbound: true },
                execute: send,
            }),
        },
    });
    const engine = new Engine({
        store,
        agents: [agent],
        channels: [agentChannel()],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch(envelope);

    await engine.idle();

    const parent = await store.runs.findOne(runId);
    const { data } = await store.runs.find({ agent: 'test' });
    const children = data.filter((run) => run.trigger.parent?.runId === runId);

    expect(children).toHaveLength(1);
    expect(parent?.taint).toMatchObject({ source: 'tool:reader' });
    expect(children[0]?.taint).toEqual(parent?.taint);
    expect(children[0]?.status).toBe('completed');
    expect(send).not.toHaveBeenCalled();
    expect((await store.steps.find(children[0]!.id)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
});

it('taints conversation recall before the next model call and gates outbound tools', async () => {
    const store = createMemoryStore();
    const conversations = new MemoryConversationRepository();
    const send = vi.fn(async () => 'sent');
    const script = mockModel([done, call('send'), done]);
    const taintsAtModel: Array<RunTaint | undefined> = [];
    const model = new MockLanguageModelV4({
        doStream: async (options) => {
            const { data } = await store.runs.find({ agent: 'test' });

            taintsAtModel.push(data.find((run) => run.status === 'running')?.taint);

            return script.doStream(options);
        },
    });
    const channel = { name: 'chat' };
    const engine = new Engine({
        store: { ...store, conversations },
        channels: [channel],
        conversations: { authorize: () => true },
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            conversation: true,
            trust: { onTainted: 'deny' },
            model,
            tools: {
                send: defineEffectTool({
                    inputSchema: z.object({}),
                    trust: { outbound: true },
                    execute: send,
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const dispatch = (text: string) => engine.channelContext(channel).dispatchConversation(
        {
            agent: 'test',
            trigger: 'message',
            payload: text,
        },
        {
            account: 'main',
            chat: 'private',
            audience: 'direct',
            text,
        },
    );
    const first = await dispatch('earlier user message');

    await engine.idle();

    expect((await store.runs.findOne(first.runId))?.taint).toBeUndefined();

    const second = await dispatch('current user message');

    await engine.idle();

    expect((await store.runs.findOne(second.runId))?.taint).toMatchObject({ source: 'conversation:recall' });
    expect(taintsAtModel[0]).toBeUndefined();
    expect(taintsAtModel.slice(1)).toEqual([
        expect.objectContaining({ source: 'conversation:recall' }),
        expect.objectContaining({ source: 'conversation:recall' }),
    ]);
    expect(send).not.toHaveBeenCalled();
    expect((await store.steps.find(second.runId)).find((step) => step.name === 'send')?.error).toMatchObject({ code: 'tool_denied' });
    expect((await store.runs.findOne(second.runId))?.status).toBe('completed');
});

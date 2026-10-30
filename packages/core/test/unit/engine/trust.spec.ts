/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { afterEach, expect, it } from 'vitest';
import { z } from 'zod';
import {
    Engine,
    createMemoryStore,
    defineAgent,
    defineEffectTool,
    defineTool,
} from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import { mockModel } from '../../utils/mock-model.ts';

const engines: Engine[] = [];

afterEach(() => engines.splice(0).forEach((engine) => engine.stop()));

const call = (toolName: string, input = {}) => ({
    parts: [{
        type: 'tool-call' as const,
        toolName,
        toolCallId: toolName,
        input,
    }],
});
const done = { parts: [{ type: 'text' as const, text: 'done' }] };

it('rejects invalid trust policies rather than silently allowing outbound calls', () => {
    expect(() => defineAgent({
        name: 'test',
        instructions: 'test',
        trust: { onTainted: 'allow' as never },
    })).toThrow('trust.onTainted');
    expect(() => defineAgent({
        name: 'test',
        instructions: 'test',
        tools: {},
        trust: { tools: { missing: { outbound: true } } },
    })).toThrow('missing');
});

it('persists untrusted result taint and denies subsequent outbound effects', async () => {
    let writes = 0;
    const store = createMemoryStore();
    const agent = defineAgent({
        name: 'test',
        instructions: 'test',
        trust: { onTainted: 'deny' },
        model: mockModel([call('read'), call('send'), done]),
        tools: {
            read: defineTool({
                inputSchema: z.object({}),
                trust: { untrustedResult: true },
                execute: async () => 'external text',
            }),
            send: defineEffectTool({
                inputSchema: z.object({}),
                trust: { outbound: true },
                execute: async () => {
                    writes++;

                    return 'sent';
                },
            }),
        },
    });
    const engine = new Engine({ store, agents: [agent] });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'test',
        channel: 'http',
        trigger: 'test',
        payload: {},
    });

    await engine.idle();

    const run = await store.runs.findOne(runId);

    expect(run?.taint).toEqual({ at: expect.any(Date), source: 'tool:read' });
    expect(writes).toBe(0);
    expect(run?.status).toBe('completed');
});

it('binds automatic approval to final input and keeps arguments out of channel notifications', async () => {
    let writes = 0;
    const notifications: unknown[] = [];
    const source: IChannel = {
        name: 'source',
        untrusted: true,
        out: async (message) => {
            notifications.push(message);
        },
    };
    const store = createMemoryStore();
    const engine = new Engine({
        store,
        channels: [source],
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            model: mockModel([call('send', { text: 'secret' }), done]),
            tools: {
                send: defineEffectTool({
                    inputSchema: z.object({ text: z.string() }),
                    trust: { outbound: true },
                    execute: async () => {
                        writes++;

                        return 'sent';
                    },
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'test',
        channel: 'source',
        address: 'public',
        trigger: 'test',
        payload: {},
    });

    await engine.idle();

    const waiting = await store.runs.findOne(runId);

    expect(waiting?.status).toBe('waiting');
    expect(waiting?.waiting?.body).toContain('secret');
    expect(JSON.stringify(notifications)).not.toContain('secret');
    expect(writes).toBe(0);
    await engine.approve(runId, { approvalId: waiting!.waiting!.approvalId, approved: true });
    await engine.idle();
    expect(writes).toBe(1);
    expect((await store.runs.findOne(runId))?.taint?.source).toBe('channel:source');
});

it.each(['plain', 'effect', 'reconciliation', 'stream'] as const)('taints externally controlled %s reader errors before the model can act on them', async (kind) => {
    let writes = 0;
    const store = createMemoryStore();
    const fail = async (): Promise<string> => {
        throw new Error('external error instructions');
    };
    const definition = {
        inputSchema: z.object({}),
        trust: { untrustedResult: true },
        execute: fail,
    };
    let reader;

    if (kind === 'plain') {
        reader = defineTool(definition);
    } else if (kind === 'stream') {
        reader = defineTool<Record<string, never>, string>({
            ...definition,
            async *execute () {
                yield* [];

                throw new Error('external error instructions');
            },
        });
    } else {
        reader = defineEffectTool({
            ...definition,
            ...(kind === 'reconciliation' ? { alreadyApplied: fail } : {}),
        });
    }

    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            trust: { onTainted: 'deny' },
            model: mockModel([call('read'), call('send'), done]),
            tools: {
                read: reader,
                send: defineEffectTool({
                    inputSchema: z.object({}),
                    trust: { outbound: true },
                    execute: async () => {
                        writes++;

                        return 'sent';
                    },
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'test',
        channel: 'http',
        trigger: 'test',
        payload: {},
    });

    await engine.idle();
    expect((await store.runs.findOne(runId))?.taint?.source).toBe('tool:read');
    expect(writes).toBe(0);
});

it('does not expose content or checkpoint it when persisting taint fails', async () => {
    const store = createMemoryStore();
    const update = store.runs.update.bind(store.runs);

    store.runs.update = async (id, patch, options) => {
        if (patch.taint) {
            throw new Error('taint storage unavailable');
        }

        return update(id, patch, options);
    };

    const model = mockModel([call('read'), done]);
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            model,
            tools: {
                read: defineTool({
                    inputSchema: z.object({}),
                    trust: { untrustedResult: true },
                    execute: async () => 'sensitive external content',
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'test',
        channel: 'http',
        trigger: 'test',
        payload: {},
    });

    await engine.idle();
    expect((await store.runs.findOne(runId))?.status).toBe('failed');
    expect(model.doStreamCalls).toHaveLength(1);
    expect(await store.checkpoints.findOne(runId)).toBeUndefined();
});

it('rechecks approval after a hook changes the final input on resume', async () => {
    let argument = 'first';
    let writes = 0;
    const store = createMemoryStore();
    const engine = new Engine({
        store,
        channels: [{ name: 'source', untrusted: true }],
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            model: mockModel([call('send', { text: 'original' }), done]),
            hooks: { beforeToolExecution: () => ({ text: argument }) },
            tools: {
                send: defineEffectTool({
                    inputSchema: z.object({ text: z.string() }),
                    trust: { outbound: true },
                    execute: async () => {
                        writes++;

                        return 'sent';
                    },
                }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'test',
        channel: 'source',
        trigger: 'test',
        payload: {},
    });

    await engine.idle();

    const first = (await store.runs.findOne(runId))!.waiting!;

    argument = 'changed';
    await engine.approve(runId, { approvalId: first.approvalId, approved: true });
    await engine.idle();

    const next = (await store.runs.findOne(runId))!.waiting!;

    expect(next.approvalId).not.toBe(first.approvalId);
    expect(next.body).toContain('changed');
    expect(writes).toBe(0);
});

it('gates direct channel emits to model-selected destinations but permits source replies', async () => {
    const sent: string[] = [];
    const source: IChannel = {
        name: 'source',
        untrusted: true,
        out: async (_message, address) => {
            sent.push(address);
        },
    };
    const store = createMemoryStore();
    const engine = new Engine({
        store,
        channels: [source],
        agents: [defineAgent({
            name: 'test',
            instructions: 'test',
            trust: { onTainted: 'deny' },
            model: mockModel([call('reply'), call('forward'), done]),
            tools: {
                reply: defineTool({ inputSchema: z.object({}), execute: async (_, { context }) => context.channels.findOneOrFail().emit({ body: 'reply' }) }),
                forward: defineTool({ inputSchema: z.object({}), execute: async (_, { context }) => context.channels.findOneOrFail().emit({ body: 'secret' }, 'elsewhere') }),
            },
        })],
    });

    engines.push(engine);
    await engine.start();
    await engine.dispatch({
        agent: 'test',
        channel: 'source',
        address: 'origin',
        trigger: 'test',
        payload: {},
    });
    await engine.idle();
    expect(sent).toEqual(['origin']);
});

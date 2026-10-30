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
    approve,
    createMemoryStore,
    defineAgent,
    defineEffectTool,
    defineTool,
} from '@chamvi/core';
import type { AgentDefinition, ToolContext } from '@chamvi/core';
import { wrapToolsForRun } from '../../../src/effect/wrap.ts';
import { gateOutbound } from '../../../src/trust/module.ts';
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
});

function setup(definition: Omit<AgentDefinition, 'name' | 'instructions'>) {
    const store = createMemoryStore();
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

it.each(['plain', 'effect', 'reconciliation', 'generator', 'iterable factory'] as const)(
    'retains the final-input classification when a %s reader mutates its input',
    async (kind) => {
        const classify = vi.fn(async (input: { external: boolean }) => input.external);
        const definition = {
            inputSchema: z.object({ external: z.boolean() }),
            trust: { taint: classify },
            execute: async (input: { external: boolean }) => {
                input.external = false;

                return 'external instructions';
            },
        };
        async function* chunks(input: { external: boolean }): AsyncGenerator<string> {
            input.external = false;
            yield 'first external chunk';
            yield 'last external chunk';
        }
        let reader;

        if (kind === 'effect' || kind === 'reconciliation') {
            reader = defineEffectTool<{ external: boolean }, string>({
                ...definition,
                ...(kind === 'reconciliation' ? { alreadyApplied: async (_key, input) => definition.execute(input) } : {}),
            });
        } else if (kind === 'generator' || kind === 'iterable factory') {
            reader = defineTool<{ external: boolean }, string>({ ...definition, execute: kind === 'generator' ? chunks : (input) => chunks(input) });
        } else {
            reader = defineTool(definition);
        }

        const send = vi.fn(async () => 'sent');
        const { engine, store } = setup({
            trust: { onTainted: 'deny' },
            model: mockModel([call('read', { external: true }), call('send'), done]),
            tools: {
                read: reader,
                send: defineTool({
                    inputSchema: z.object({}),
                    trust: { guardWhenTainted: true },
                    execute: send,
                }),
            },
        });
        const { runId } = await engine.dispatch(envelope);

        await engine.start();
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect((await store.runs.findOne(runId))?.taint?.source).toBe('tool:read');
        expect(classify).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
    },
);

it.each(['plain', 'effect', 'reconciliation', 'generator', 'iterable factory'] as const)(
    'retains the classification when a %s reader mutates its input and throws',
    async (kind) => {
        const classify = vi.fn((input: { external: boolean }) => input.external);
        const fail = async (input: { external: boolean }): Promise<string> => {
            input.external = false;

            throw new Error('external error instructions');
        };
        async function* chunks(input: { external: boolean }): AsyncGenerator<string> {
            yield* [];
            await fail(input);
        }
        const definition = {
            inputSchema: z.object({ external: z.boolean() }),
            trust: { taint: classify },
            execute: fail,
        };
        let reader;

        if (kind === 'effect' || kind === 'reconciliation') {
            reader = defineEffectTool<{ external: boolean }, string>({
                ...definition,
                ...(kind === 'reconciliation' ? { alreadyApplied: async (_key, input) => fail(input) } : {}),
            });
        } else if (kind === 'generator' || kind === 'iterable factory') {
            reader = defineTool<{ external: boolean }, string>({ ...definition, execute: kind === 'generator' ? chunks : (input) => chunks(input) });
        } else {
            reader = defineTool(definition);
        }

        const send = vi.fn(async () => 'sent');
        const { engine, store } = setup({
            trust: { onTainted: 'deny' },
            model: mockModel([call('read', { external: true }), call('send'), done]),
            tools: {
                read: reader,
                send: defineTool({
                    inputSchema: z.object({}),
                    trust: { guardWhenTainted: true },
                    execute: send,
                }),
            },
        });
        const { runId } = await engine.dispatch(envelope);

        await engine.start();
        await engine.idle();
        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect((await store.runs.findOne(runId))?.taint?.source).toBe('tool:read');
        expect(classify).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
    },
);

it.each(['guardWhenTainted', 'taint'] as const)('refuses an unbound %s tool before executing it', async (flag) => {
    const execute = vi.fn(async () => 'result');
    const context = {
        run: {
            runId: 'unbound',
            agent: 'test',
            trigger: {
                ...envelope,
                id: 'trigger',
                receivedAt: new Date(),
            },
            signal: new AbortController().signal,
        },
    } as ToolContext;
    const store = createMemoryStore();
    const tools = wrapToolsForRun({
        classified: defineTool({
            inputSchema: z.object({}),
            trust: { [flag]: true },
            execute,
        }),
    }, context, store.effects);

    await expect(tools.classified!.execute!({}, {
        toolCallId: 'classified',
        messages: [],
        context,
    })).rejects.toThrow('execution-bound trust context');
    await expect(gateOutbound(context, 'classified', {})).rejects.toThrow('execution-bound trust context');
    expect(execute).not.toHaveBeenCalled();
});

it('keeps the execution trust identity when a tool replaces public ToolContext.run', async () => {
    const send = vi.fn(async () => 'sent');
    const { engine, store } = setup({
        trust: { onTainted: 'deny' },
        model: mockModel([call('read'), call('replace'), call('send'), done]),
        tools: {
            read: defineTool({
                inputSchema: z.object({}),
                trust: { taint: true },
                execute: async () => 'external instructions',
            }),
            replace: defineTool({
                inputSchema: z.object({}),
                execute: async (_, { context }) => {
                    context.run = { ...context.run };

                    return 'ok';
                },
            }),
            send: defineTool({
                inputSchema: z.object({}),
                trust: { guardWhenTainted: true },
                execute: send,
            }),
        },
    });
    const { runId } = await engine.dispatch(envelope);

    await engine.start();
    await engine.idle();
    expect((await store.runs.findOne(runId))?.taint).toBeDefined();
    expect(send).not.toHaveBeenCalled();
});

it('replays an ordinary approval after parallel taint adds an automatic gate on resume', async () => {
    const send = vi.fn();
    const { engine, store } = setup({
        model: mockModel([{ parts: [...call('send').parts, ...call('read').parts] }, done]),
        tools: {
            read: defineTool({
                inputSchema: z.object({}),
                trust: { taint: true },
                execute: async () => 'external instructions',
            }),
            send: defineTool({
                inputSchema: z.object({}),
                trust: { guardWhenTainted: true },
                execute: async (_, { context }) => {
                    const decision = await approve(context, { title: 'Manual send approval' });

                    if (decision.approved) {
                        send();
                    }

                    return 'done';
                },
            }),
        },
    });
    const { runId } = await engine.dispatch(envelope);

    await engine.start();
    await engine.idle();

    const manual = (await store.runs.findOne(runId))!.waiting!;

    expect(manual.title).toBe('Manual send approval');
    expect(manual.approvalId).toBe('0:send:0');
    await engine.approve(runId, { approvalId: manual.approvalId, approved: true });
    await engine.idle();

    const automatic = (await store.runs.findOne(runId))!.waiting!;

    expect(automatic.approvalId).toMatch(/^bound:/);
    expect(send).not.toHaveBeenCalled();
    await engine.approve(runId, { approvalId: automatic.approvalId, approved: true });
    await engine.idle();
    expect((await store.runs.findOne(runId))?.status).toBe('completed');
    expect(send).toHaveBeenCalledTimes(1);
});

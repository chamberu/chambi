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
    ChannelNotFoundError,
    Engine,
    InvalidRunStateError,
    consoleChannel,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    AgentDefinition,
    ChannelHandle,
    ChannelMessage,
    ChannelSendOptions,
    IChannel,
    ToolContext,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { createMemoryStores } from '../../../src/store/index.ts';
import { stableHash } from '../../../src/effect/helpers.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

type Sent = {
    message: ChannelMessage;
    address: string;
    opts: ChannelSendOptions
};

function recorder(name: string) {
    const calls: Sent[] = [];
    const state = { failures: 0 };
    const channel: IChannel = {
        name,
        async out(message, address, opts) {
            calls.push({
                message,
                address,
                opts,
            });
            if (state.failures > 0) {
                state.failures -= 1;
                throw new Error('channel down');
            }
        },
    };
    return {
        channel,
        calls,
        state,
    };
}

/** A channel without out (inbound only). */
const web: IChannel = { name: 'web', in: async () => new Response(null) };

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const call = (toolName: string, input: unknown = {}, toolCallId?: string): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
        toolCallId,
    }],
});

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

function setup(
    model: LanguageModel,
    tools: AgentDefinition['tools'],
    opts: {
        stores?: ReturnType<typeof createMemoryStores>;
        clock?: ControllableClock;
        channels?: IChannel[]
    } = {},
) {
    const clock = opts.clock ?? new ControllableClock(new Date(1_000_000));
    const store = opts.stores ?? createMemoryStores({ clock });
    const slack = recorder('slack');
    const errors: unknown[] = [];
    const engine = new Engine({
        stores: store,
        agents: [defineAgent({
            name: 'ops',
            instructions: 'You operate.',
            model,
            tools,
        })],
        channels: opts.channels ?? [slack.channel, web],
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
    });
    engines.push(engine);
    return {
        engine,
        stores: store,
        clock,
        slack,
        errors,
    };
}

async function run(
    ctx: { engine: Engine; stores: ReturnType<typeof createMemoryStores> },
    envelope: { channel?: string; address?: string } = {},
) {
    await ctx.engine.start();
    const { runId } = await ctx.engine.dispatch({
        agent: 'ops',
        trigger: 'test',
        channel: envelope.channel ?? 'web',
        address: envelope.address,
        payload: {},
    });
    await ctx.engine.idle();
    return {
        runId,
        run: await ctx.stores.runs.getRun(runId),
        steps: await ctx.stores.steps.listSteps(runId),
    };
}

const emitTool = (fn: (ctx: ToolContext, input: { body: string }) => Promise<unknown>) => defineTool({
    inputSchema: z.object({ body: z.string() }),
    execute: async (input, { context }) => {
        await fn(context, input);
        return 'sent';
    },
});

describe('channel outbound', () => {
    it('emit sends through out with the content key', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ title: 't', body }, 'C1')) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), text('done')]), tools);
        const { runId, run: stored } = await run(ctx);
        expect(stored?.status).toBe('completed');
        expect(ctx.slack.calls).toHaveLength(1);
        const [sent] = ctx.slack.calls as [Sent];
        expect(sent.message).toEqual({
            kind: 'message',
            key: `${runId}:emit:slack:${stableHash({
                address: 'C1',
                title: 't',
                body: 'b',
            })}`,
            runId,
            agent: 'ops',
            title: 't',
            body: 'b',
        });
        expect(sent.address).toBe('C1');
        expect(sent.opts.trigger).toEqual(stored?.trigger);
        expect(sent.opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('identical emits in one step reach out once', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ body }, 'C1')) };
        const model = mockModel([
            {
                parts: [
                    {
                        type: 'tool-call',
                        toolName: 'notify',
                        input: { body: 'b' },
                        toolCallId: 'a',
                    },
                    {
                        type: 'tool-call',
                        toolName: 'notify',
                        input: { body: 'b' },
                        toolCallId: 'b',
                    },
                ],
            },
            call('notify', { body: 'b' }),
            text('done'),
        ]);
        const ctx = setup(model, tools);
        const { run: stored } = await run(ctx);
        expect(stored?.status).toBe('completed');
        expect(ctx.slack.calls).toHaveLength(1);
    });

    it('identical emits in one step and after a recovery reach out once', async () => {
        const storeClock = new ControllableClock(new Date(1_000_000));
        const store = createMemoryStores({ clock: storeClock });
        const slack = recorder('slack');
        const parallel: MockResponse = {
            parts: [
                {
                    type: 'tool-call',
                    toolName: 'notify',
                    input: { body: 'b' },
                    toolCallId: 'a',
                },
                {
                    type: 'tool-call',
                    toolName: 'notify',
                    input: { body: 'b' },
                    toolCallId: 'b',
                },
            ],
        };
        let hung = 0;
        const tools = (hang: boolean): ToolSet => ({
            notify: emitTool(async (ctx, { body }) => {
                await ctx.channels.findOneOrFail('slack').emit({ body }, 'C1');
                if (hang) {
                    hung += 1;
                    // the replica dies here: the step's checkpoint never lands
                    await new Promise(() => {});
                }
            }),
        });

        // replica A: its own clock, so its claim is never renewed
        const a = setup(mockModel([parallel]), tools(true), {
            stores: store,
            clock: new ControllableClock(new Date(1_000_000)),
            channels: [slack.channel, web],
        });
        await a.engine.start();
        const { runId } = await a.engine.dispatch({
            agent: 'ops',
            trigger: 'test',
            channel: 'web',
            payload: {},
        });
        await vi.waitFor(() => expect(hung).toBe(2));
        expect(slack.calls).toHaveLength(1);
        a.engine.stop();

        // replica B recovers the run once A's claim expired and redoes the step
        storeClock.advance(1000);
        const b = setup(mockModel([parallel, text('done')]), tools(false), {
            stores: store,
            clock: storeClock,
            channels: [slack.channel, web],
        });
        await b.engine.start();
        await vi.waitFor(async () => expect((await store.runs.getRun(runId))?.status).toBe('completed'));
        expect(slack.calls).toHaveLength(1);
    });

    it('an explicit key overrides the content key', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ body, key: 'deploy-1' }, 'C1')) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), call('notify', { body: 'other' }), text('done')]), tools);
        await run(ctx);
        expect(ctx.slack.calls).toHaveLength(1);
        expect(ctx.slack.calls[0]?.message.key).toBe('deploy-1');
    });

    it('emit without an address on a non-source channel is a ValidationError tool error', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ body })) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), text('done')]), tools);
        const { run: stored, steps } = await run(ctx);
        expect(stored?.status).toBe('completed');
        expect(ctx.slack.calls).toHaveLength(0);
        expect(steps.find((s) => s.kind === 'tool')?.error).toMatchObject({ code: 'validation_error' });
    });

    it('emit and approve without an address on a channel with a defaultAddress send there', async () => {
        const owner = recorder('owner');
        const chat: IChannel = { ...owner.channel, defaultAddress: 'me' };
        const tools: ToolSet = {
            notify: emitTool(async (ctx, { body }) => {
                await ctx.channels.findOneOrFail('owner').emit({ body });
                return ctx.channels.findOneOrFail('owner').approve({ title: 'ok?' });
            }),
        };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), text('done')]), tools, { channels: [chat, web] });
        const { run: stored } = await run(ctx);
        await ctx.engine.idle();
        expect(stored?.status).toBe('waiting');
        expect(stored?.waiting?.address).toBe('me');
        expect(owner.calls.map((c) => [c.message.kind, c.address])).toEqual([['message', 'me'], ['approval', 'me']]);
    });

    it('consoleChannel takes emits without an address', async () => {
        const lines: string[] = [];
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('console').emit({ body })) };
        const ctx = setup(mockModel([call('notify', { body: 'hello' }), text('done')]), tools, {
            channels: [consoleChannel({
                write: (line) => {
                    lines.push(line);
                },
            }), web],
        });
        const { run: stored, steps } = await run(ctx);
        expect(stored?.status).toBe('completed');
        expect(steps.find((s) => s.kind === 'tool')?.output).toBe('sent');
        expect(lines).toContain('hello');
    });

    it('emit without an address on the source channel uses trigger.address', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ body })) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), text('done')]), tools);
        await run(ctx, { channel: 'slack', address: 'C9' });
        expect(ctx.slack.calls).toHaveLength(1);
        expect(ctx.slack.calls[0]?.address).toBe('C9');
    });

    it('a throwing out records nothing and is a tool error; the next identical emit sends again', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail('slack').emit({ body }, 'C1')) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), call('notify', { body: 'b' }), text('done')]), tools);
        ctx.slack.state.failures = 1;
        const { run: stored, steps } = await run(ctx);
        expect(stored?.status).toBe('completed');
        expect(ctx.slack.calls).toHaveLength(2);
        const toolSteps = steps.filter((s) => s.kind === 'tool');
        expect(toolSteps[0]?.error).toMatchObject({ message: 'channel down' });
        expect(toolSteps[1]?.error).toBeUndefined();
    });

    it('emit outside a tool call (in the tools factory) throws InvalidRunStateError', async () => {
        let pending: Promise<void> | undefined;
        const ctx = setup(mockModel([text('done')]), (toolContext) => {
            pending = toolContext.channels.findOneOrFail('slack').emit({ body: 'b' }, 'C1');
            pending.catch(() => {});
            return {};
        });
        const { run: stored } = await run(ctx);
        expect(stored?.status).toBe('completed');
        await expect(pending).rejects.toBeInstanceOf(InvalidRunStateError);
        expect(ctx.slack.calls).toHaveLength(0);
    });

    it('channels.findOne() is undefined for an unknown channel or one without out', async () => {
        const seen: Array<ChannelHandle | undefined> = [];
        const ctx = setup(mockModel([text('done')]), (toolContext) => {
            seen.push(toolContext.channels.findOne('nope'), toolContext.channels.findOne('web'));
            return {};
        });
        await run(ctx);
        expect(seen).toEqual([undefined, undefined]);
    });

    it('channels.findOneOrFail() throws ChannelNotFoundError for an unknown channel or one without out', async () => {
        const thrown: unknown[] = [];
        let found: ChannelHandle | undefined;
        const ctx = setup(mockModel([text('done')]), (toolContext) => {
            for (const name of ['nope', 'web']) {
                try {
                    toolContext.channels.findOneOrFail(name);
                } catch (error) {
                    thrown.push(error);
                }
            }
            found = toolContext.channels.findOneOrFail('slack');
            return {};
        });
        await run(ctx);
        expect(found?.name).toBe('slack');
        expect(thrown).toHaveLength(2);
        for (const error of thrown) {
            expect(error).toBeInstanceOf(ChannelNotFoundError);
            expect(error).toMatchObject({ code: 'channel_not_found' });
        }
        expect((thrown[0] as Error).message).toContain('"nope"');
    });

    it('channels.findOneOrFail() without a name names the source channel', async () => {
        const thrown: unknown[] = [];
        const ctx = setup(mockModel([text('done')]), (toolContext) => {
            try {
                toolContext.channels.findOneOrFail();
            } catch (error) {
                thrown.push(error);
            }
            return {};
        });
        await run(ctx, { channel: 'web', address: 'x' });
        expect(thrown[0]).toBeInstanceOf(ChannelNotFoundError);
        expect((thrown[0] as Error).message).toContain('"web"');
    });

    it('channels.find() lists every channel with out, in registration order, bound like findOne()', async () => {
        const seen: ChannelHandle[][] = [];
        const ctx = setup(mockModel([text('done')]), (toolContext) => {
            seen.push(toolContext.channels.find());
            return {};
        });
        await run(ctx, { channel: 'slack', address: 'C9' });
        const names = seen[0]!.map((handle) => handle.name);
        expect(names).not.toContain('web');
        expect(names).toContain('slack');
        expect(seen[0]!.find((handle) => handle.name === 'slack')?.address).toBe('C9');
    });

    it('channels.findOne() without a name is the source channel, bound to trigger.address', async () => {
        const seen: Array<ChannelHandle | undefined> = [];
        const tools = (toolContext: ToolContext) => {
            seen.push(toolContext.channels.findOne());
            return {};
        };
        await run(setup(mockModel([text('done')]), tools), { channel: 'web', address: 'x' });
        await run(setup(mockModel([text('done')]), tools), { channel: 'slack' });
        await run(setup(mockModel([text('done')]), tools), { channel: 'slack', address: 'C9' });
        expect(seen[0]).toBeUndefined();
        expect(seen[1]?.name).toBe('slack');
        expect(seen[1]?.address).toBeUndefined();
        expect(seen[2]?.name).toBe('slack');
        expect(seen[2]?.address).toBe('C9');
    });

    it('channels.findOne() emits to the source address', async () => {
        const tools: ToolSet = { notify: emitTool((ctx, { body }) => ctx.channels.findOneOrFail().emit({ body })) };
        const ctx = setup(mockModel([call('notify', { body: 'Done.' }), text('done')]), tools);
        await run(ctx, { channel: 'slack', address: 'C9' });
        expect(ctx.slack.calls.map((c) => [c.address, c.message.body])).toEqual([['C9', 'Done.']]);
    });

    it('emit refuses a message without a string body', async () => {
        const tools: ToolSet = { notify: emitTool((ctx) => ctx.channels.findOneOrFail('slack').emit({ body: 42 } as never, 'C1')) };
        const ctx = setup(mockModel([call('notify', { body: 'b' }), text('done')]), tools);
        const { steps } = await run(ctx);
        expect(ctx.slack.calls).toHaveLength(0);
        expect(steps.find((s) => s.kind === 'tool')?.error).toMatchObject({ code: 'validation_error' });
    });
});

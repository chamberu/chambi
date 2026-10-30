/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { ToolSet } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import { Engine, ToolNotAllowedError, defineAgent } from '@chamvi/core';
import {
    EFFECT,
    defineEffectTool,
    effectMarker,
    wrapToolsForRun,
} from '../../../src/effect/index.ts';
import { stableHash } from '../../../src/effect/helpers.ts';
import { createRunArtifacts } from '../../../src/artifact/module.ts';
import { systemClock } from '../../../src/clock/index.ts';
import type { RunContext } from '../../../src/run/types.ts';
import { createAgentState } from '../../../src/state/module.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { defineTool } from '../../../src/tool/define.ts';
import { toolContextSchema } from '../../../src/tool/constants.ts';
import type { ToolContext } from '../../../src/tool/types.ts';
import { mockModel } from '../../utils/mock-model.ts';

function toolContext(runId: string): ToolContext {
    const store = createMemoryStore();
    return {
        channels: {} as ToolContext['channels'],
        run: {
            runId,
            agent: 'triage',
            trigger: {
                agent: 'triage',
                trigger: 'http',
                channel: 'http',
                payload: {},
            } as RunContext['trigger'],
            signal: new AbortController().signal,
        },
        state: createAgentState('triage', undefined, store.state),
        artifacts: createRunArtifacts(store.artifacts, { id: runId, agent: 'triage' }, systemClock),
    };
}

const ctx = toolContext('r1');
const callOpts = { toolCallId: 'c', messages: [] };
const schema = z.object({ body: z.string(), n: z.number().optional() });

const engines: Engine[] = [];
afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

async function call(tools: ToolSet, name: string, input: unknown, context: ToolContext = ctx) {
    const t = tools[name];
    return (t?.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, { ...callOpts, context });
}

describe('effect tools', () => {
    it('hands the tool context to execute, effectKey and alreadyApplied', async () => {
        const seen: unknown[] = [];
        const post = defineEffectTool({
            inputSchema: schema,
            effectKey: (input, c) => {
                seen.push(c);
                return `${c.run.runId}:k:${input.body}`;
            },
            alreadyApplied: async (_key, _input, c) => {
                seen.push(c);
                return undefined;
            },
            execute: async (_input, { context }) => {
                seen.push(context);
                return 'ok';
            },
        });
        expect(post.contextSchema).toBe(toolContextSchema);
        await call(wrapToolsForRun({ post }, ctx, createMemoryStore().effects), 'post', { body: 'x' });
        expect(seen).toEqual([ctx, ctx, ctx]);
        expect(seen.every((c) => c === ctx)).toBe(true);
    });

    it('hands the call options to effectKey', async () => {
        const seen: unknown[] = [];
        const post = defineEffectTool({
            inputSchema: schema,
            effectKey: (_input, c, options) => {
                seen.push(options.toolCallId, options.messages.length);
                return `${c.run.runId}:k`;
            },
            execute: async () => 'ok',
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        await (tools.post?.execute as (i: unknown, o: unknown) => Promise<unknown>)(
            { body: 'x' },
            {
                ...callOpts,
                toolCallId: 'call-1',
                messages: [{ role: 'user', content: 'x' }],
                context: ctx,
            },
        );
        expect(seen).toEqual(['call-1', 1]);
    });

    it('keeps contextSchema and forwards options.context through the wrapper', async () => {
        const plain = defineTool({ inputSchema: schema, execute: async (_i, { context }) => context });
        const wrapped = wrapToolsForRun({ plain }, ctx, createMemoryStore().effects, { allow: () => true });
        expect(wrapped.plain!.contextSchema).toBe(toolContextSchema);
        expect(await call(wrapped, 'plain', { body: 'x' })).toBe(ctx);
    });

    it('a key built from ctx.run.runId differs per run', async () => {
        let runs = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            effectKey: (_input, c) => `${c.run.runId}:c`,
            execute: async () => ++runs,
        });
        const store = createMemoryStore();
        const r2 = toolContext('r2');
        await call(wrapToolsForRun({ post }, ctx, store.effects), 'post', { body: 'x' });
        await call(wrapToolsForRun({ post }, r2, store.effects), 'post', { body: 'x' }, r2);
        expect(runs).toBe(2);
        expect(await store.effects.findOne('r1:c')).toEqual({ result: 1 });
        expect(await store.effects.findOne('r2:c')).toEqual({ result: 2 });
    });

    it('effect executes once per key', async () => {
        let runs = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => ({ id: ++runs }),
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        const a = await call(tools, 'post', { body: 'hi' });
        const b = await call(tools, 'post', { body: 'hi' });
        const c = await call(tools, 'post', { body: 'other' });
        expect(a).toEqual({ id: 1 });
        expect(b).toEqual({ id: 1 });
        expect(c).toEqual({ id: 2 });
        expect(runs).toBe(2);
    });

    it('effect is not reapplied after resume', async () => {
        let runs = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => ({ id: ++runs }),
        });
        // a crash before the checkpoint lands: the resumed run starts from scratch
        const store = createMemoryStore();
        vi.spyOn(store.checkpoints, 'save').mockResolvedValue(undefined);
        const turn = {
            parts: [{
                type: 'tool-call' as const,
                toolName: 'post',
                input: { body: 'hi' },
            }],
        };
        const done = { parts: [{ type: 'text' as const, text: 'done' }] };
        const make = (model: ReturnType<typeof mockModel>) => {
            const engine = new Engine({
                store,
                agents: [defineAgent({
                    name: 'triage',
                    instructions: 'x',
                    model,
                    tools: () => ({ post }),
                })],
                onError: () => {},
            });
            engines.push(engine);
            return engine;
        };

        const first = make(mockModel([turn, done]));
        await first.start();
        const { runId } = await first.dispatch({
            agent: 'triage',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await first.idle();
        first.stop();
        expect(runs).toBe(1);

        // the process died mid-run: requeue and resume with a model re-issuing the call
        await store.runs.update(runId, { status: 'queued', claim: undefined });
        const second = make(mockModel([turn, done]));
        await second.start();
        await second.idle();

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect(runs).toBe(1);
        // the replayed call was re-issued and answered from the stored effect
        const toolSteps = (await store.steps.find(runId)).filter((st) => st.kind === 'tool');
        expect(toolSteps).toHaveLength(2);
        expect(toolSteps.map((st) => st.output)).toEqual([{ id: 1 }, { id: 1 }]);
    });

    it('alreadyApplied short-circuits execute', async () => {
        let runs = 0;
        const seen: string[] = [];
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => ({ id: ++runs }),
            alreadyApplied: async (key) => {
                seen.push(key);
                return { id: 99 };
            },
        });
        const store = createMemoryStore();
        const tools = wrapToolsForRun({ post }, ctx, store.effects);
        expect(await call(tools, 'post', { body: 'hi' })).toEqual({ id: 99 });
        expect(runs).toBe(0);
        expect(seen).toEqual([`r1:post:${stableHash({ body: 'hi' })}`]);
        expect(await store.effects.findOne(seen[0] as string)).toEqual({ result: { id: 99 } });
    });

    it('does not record the effect when execute throws', async () => {
        let runs = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => {
                if (++runs === 1) throw new Error('boom');
                return 'ok';
            },
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        await expect(call(tools, 'post', { body: 'hi' })).rejects.toThrow('boom');
        expect(await call(tools, 'post', { body: 'hi' })).toBe('ok');
    });

    it('uses a custom effectKey', async () => {
        const post = defineEffectTool({
            inputSchema: schema,
            effectKey: (input) => `custom:${input.body}`,
            execute: async () => 'x',
        });
        const store = createMemoryStore();
        await call(wrapToolsForRun({ post }, ctx, store.effects), 'post', { body: 'hi' });
        expect(await store.effects.findOne('custom:hi')).toEqual({ result: 'x' });
    });

    it('non-effect tools are not memoized', async () => {
        let runs = 0;
        const plain = tool({ inputSchema: schema, execute: async () => ++runs });
        const tools = wrapToolsForRun({ plain }, ctx, createMemoryStore().effects);
        // wrapped only to run inside its tool-call frame
        expect(tools.plain).toMatchObject({ inputSchema: plain.inputSchema });
        await call(tools, 'plain', { body: 'hi' });
        await call(tools, 'plain', { body: 'hi' });
        expect(runs).toBe(2);
    });

    it('marks effect tools', () => {
        const post = defineEffectTool({ inputSchema: schema, execute: async () => 1 });
        expect(post[EFFECT]).toBe(true);
    });

    it('effectMarker format', () => {
        expect(effectMarker('r1:post:abc')).toBe('<!-- chamvi:effect=r1:post:abc -->');
    });

    it('stableHash ignores key order and undefined, keeps array order', () => {
        expect(stableHash({ a: 1, b: { c: 2, d: 3 } })).toBe(stableHash({ b: { d: 3, c: 2 }, a: 1 }));
        expect(stableHash({ a: 1, b: undefined })).toBe(stableHash({ a: 1 }));
        expect(stableHash([1, 2])).not.toBe(stableHash([2, 1]));
    });

    it('stableHash distinguishes Dates', () => {
        expect(stableHash({ at: new Date('2026-01-01') })).not.toBe(stableHash({ at: new Date('2026-01-02') }));
    });

    it('identical parallel calls execute once', async () => {
        let runs = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => {
                await new Promise((r) => { setImmediate(r); });
                return ++runs;
            },
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        const out = await Promise.all([call(tools, 'post', { body: 'hi' }), call(tools, 'post', { body: 'hi' })]);
        expect(out).toEqual([1, 1]);
        expect(runs).toBe(1);
    });

    it('a stored effect skips alreadyApplied', async () => {
        let checks = 0;
        const post = defineEffectTool({
            inputSchema: schema,
            execute: async () => 'x',
            alreadyApplied: async () => {
                checks++;
                return undefined;
            },
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        await call(tools, 'post', { body: 'hi' });
        await call(tools, 'post', { body: 'hi' });
        expect(checks).toBe(1);
    });

    it('returns the result when putEffect fails', async () => {
        const broken = createMemoryStore();
        vi.spyOn(broken.effects, 'save').mockRejectedValue(new Error('disk full'));
        const post = defineEffectTool({ inputSchema: schema, execute: async () => 'sent' });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const tools = wrapToolsForRun({ post }, ctx, broken.effects);
        expect(await call(tools, 'post', { body: 'hi' })).toBe('sent');
        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it('a throwing effectKey becomes a rejection', async () => {
        const post = defineEffectTool({
            inputSchema: schema,
            effectKey: () => {
                throw new Error('bad key');
            },
            execute: async () => 'x',
        });
        const tools = wrapToolsForRun({ post }, ctx, createMemoryStore().effects);
        await expect(call(tools, 'post', { body: 'hi' })).rejects.toThrow('bad key');
    });
});

describe('tool allow check', () => {
    it('refuses a call the check rejects with ToolNotAllowedError, without executing', async () => {
        let runs = 0;
        const plain = tool({ inputSchema: schema, execute: async () => ++runs });
        const post = defineEffectTool({ inputSchema: schema, execute: async () => ++runs });
        const store = createMemoryStore();
        const tools = wrapToolsForRun({ plain, post }, ctx, store.effects, { allow: (name) => name === 'none' });
        await expect(call(tools, 'plain', { body: 'hi' })).rejects.toBeInstanceOf(ToolNotAllowedError);
        await expect(call(tools, 'post', { body: 'hi' })).rejects.toMatchObject({ code: 'tool_not_allowed' });
        expect(runs).toBe(0);

        const allowed = wrapToolsForRun({ plain }, ctx, store.effects, { allow: (name) => name === 'plain' });
        expect(await call(allowed, 'plain', { body: 'hi' })).toBe(1);
    });
});

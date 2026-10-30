/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModel } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    ContextNotProvidedError,
    Engine,
    defineAgent,
    defineTool,
    resolveModel,
} from '@chamvi/core';
import type {
    AgentDefinition,
    EngineOptions,
    IModelResolver,
    ToolContext,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
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

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const callTool = (toolName: string): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input: {},
    }],
});

/** Records every resolve(); answers with the model mapped to the ref. */
function recordingResolver(models: Record<string, LanguageModel>): IModelResolver & { resolved: string[] } {
    const resolved: string[] = [];

    return {
        resolved,
        check() {},
        resolve(ref: string) {
            resolved.push(ref);

            const model = models[ref];

            if (!model) {
                throw new Error(`no model ${ref}`);
            }

            return model;
        },
    };
}

function setup(
    definition: Partial<AgentDefinition>,
    options: Partial<EngineOptions> = {},
) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const agent = defineAgent({
        name: 'ops',
        instructions: 'You operate.',
        ...definition,
    });
    const engine = new Engine({
        store,
        agents: [agent],
        clock,
        claimTtlMs: 30,
        onError: () => {},
        ...options,
    });

    engines.push(engine);

    return { store, engine };
}

async function runOn(engine: Engine, store: ReturnType<typeof createMemoryStore>) {
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'ops',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    await engine.idle();

    return {
        run: await store.runs.findOne(runId),
        steps: await store.steps.find(runId),
    };
}

function seeingTool(seen: unknown[], ref?: string) {
    return defineTool({
        inputSchema: z.object({}),
        execute: async (_input, { context }) => {
            seen.push(resolveModel(context, ref));

            return 'ok';
        },
    });
}

describe('resolveModel', () => {
    it('without ref: the agent model, else the default', async () => {
        const own = mockModel([callTool('use'), text('done')]);
        const seen: unknown[] = [];
        const a = setup({ model: own, tools: { use: seeingTool(seen) } });

        expect((await runOn(a.engine, a.store)).run?.status).toBe('completed');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(own);

        const fallback = mockModel([callTool('use'), text('done')]);
        const other: unknown[] = [];
        const b = setup({ tools: { use: seeingTool(other) } }, { model: fallback });

        expect((await runOn(b.engine, b.store)).run?.status).toBe('completed');
        expect(other).toHaveLength(1);
        expect(other[0]).toBe(fallback);
    });

    it('a string ref goes through the resolver', async () => {
        const delegate = mockModel([]);
        const models = recordingResolver({ 'router/cc/claude-opus-4-6': delegate });
        const seen: unknown[] = [];
        const { engine, store } = setup(
            { model: mockModel([callTool('use'), text('done')]), tools: { use: seeingTool(seen, 'router/cc/claude-opus-4-6') } },
            { models },
        );

        expect((await runOn(engine, store)).run?.status).toBe('completed');
        expect(models.resolved).toEqual(['router/cc/claude-opus-4-6']);
        expect(seen[0]).toBe(delegate);
    });

    it('an object ref is returned as is', async () => {
        const delegate = mockModel([]);
        const seen: unknown[] = [];
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(resolveModel(context, delegate));

                return 'ok';
            },
        });
        const { engine, store } = setup({ model: mockModel([callTool('use'), text('done')]), tools: { use } });

        expect((await runOn(engine, store)).run?.status).toBe('completed');
        expect(seen).toEqual([delegate]);
    });

    it('without a resolver a string ref is an InvalidAgentDefinitionError tool error', async () => {
        const { engine, store } = setup({
            model: mockModel([callTool('use'), text('done')]),
            tools: { use: seeingTool([], 'router/cc/claude-opus-4-6') },
        });
        const { run, steps } = await runOn(engine, store);

        expect(run?.status).toBe('completed');

        const step = steps.find((s) => s.kind === 'tool' && s.name === 'use');

        expect((step?.error as { code: string } | undefined)?.code).toBe('invalid_agent_definition');
        expect((step?.error as { message: string } | undefined)?.message).toBe(
            'resolveModel(): the model string "router/cc/claude-opus-4-6" needs a model resolver (EngineOptions.models).',
        );
    });

    it('a ref the resolver refuses is an InvalidAgentDefinitionError tool error', async () => {
        const models = recordingResolver({});
        const { engine, store } = setup(
            { model: mockModel([callTool('use'), text('done')]), tools: { use: seeingTool([], 'router/unknown') } },
            { models },
        );
        const { run, steps } = await runOn(engine, store);

        expect(run?.status).toBe('completed');

        const step = steps.find((s) => s.kind === 'tool' && s.name === 'use');

        expect((step?.error as { code: string } | undefined)?.code).toBe('invalid_agent_definition');
        expect((step?.error as { message: string } | undefined)?.message).toContain('Model "router/unknown" could not be resolved');
    });

    it('reads the live agent registry', async () => {
        const first = mockModel([]);
        const second = mockModel([callTool('use'), text('done')]);
        const seen: unknown[] = [];
        const { engine, store } = setup({ model: first, tools: { use: seeingTool(seen) } });

        await engine.putAgent(defineAgent({
            name: 'ops',
            instructions: 'You operate.',
            model: second,
            tools: { use: seeingTool(seen) },
        }));
        expect((await runOn(engine, store)).run?.status).toBe('completed');
        expect(seen).toEqual([second]);
    });

    it('works in the tools factory', async () => {
        const own = mockModel([text('done')]);
        let seen: unknown;
        const { engine, store } = setup({
            model: own,
            tools: (ctx) => {
                seen = resolveModel(ctx);

                return {};
            },
        });

        expect((await runOn(engine, store)).run?.status).toBe('completed');
        expect(seen).toBe(own);
    });

    it('ToolContext keys unchanged', async () => {
        let keys: string[] = [];
        const { engine, store } = setup({
            model: mockModel([text('done')]),
            tools: (ctx) => {
                keys = Object.keys(ctx).sort();

                return {};
            },
        });

        expect((await runOn(engine, store)).run?.status).toBe('completed');
        expect(keys).toEqual(['artifacts', 'channels', 'run', 'state']);
    });

    it('a hand-built context throws ContextNotProvidedError', () => {
        const ctx: ToolContext = {
            channels: {} as ToolContext['channels'],
            run: { agent: 'ops' } as ToolContext['run'],
            state: {} as ToolContext['state'],
            artifacts: {} as ToolContext['artifacts'],
        };

        expect(() => resolveModel(ctx)).toThrow(ContextNotProvidedError);
    });
});

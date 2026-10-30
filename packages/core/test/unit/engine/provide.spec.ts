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
    InvalidAgentDefinitionError,
    defineAgent,
    defineContextKey,
    defineEffectTool,
    defineTool,
    inject,
    tryInject,
} from '@chamvi/core';
import type {
    AgentDefinition,
    ContextKey,
    IEngine,
    ToolContext,
} from '@chamvi/core';
import { ControllableClock } from '../../utils/clock.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

type Service = { id: string };

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const callTool = (toolName: string, input: unknown = {}): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
    }],
});

function setup(model: LanguageModel, tools: AgentDefinition['tools']) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const errors: unknown[] = [];
    const agent = defineAgent({
        name: 'ops',
        instructions: 'You operate.',
        model,
        tools,
    });
    const engine = new Engine({
        store,
        agents: [agent],
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return {
        store,
        engine,
        errors,
    };
}

async function runOn(engine: IEngine, store: ReturnType<typeof createMemoryStore>) {
    const { runId } = await engine.dispatch({
        agent: 'ops',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    await engine.idle();

    return { runId, run: await store.runs.findOne(runId) };
}

async function toolStep(store: ReturnType<typeof createMemoryStore>, runId: string, name: string) {
    return (await store.steps.find(runId)).find((s) => s.kind === 'tool' && s.name === name);
}

describe('engine.provide', () => {
    it('inject in execute returns the provided value by identity', async () => {
        const KEY = defineContextKey<Service>('service');
        const value: Service = { id: 's1' };
        const seen: unknown[] = [];
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(inject(context, KEY));

                return 'ok';
            },
        });
        const { engine, store } = setup(mockModel([callTool('use'), text('done')]), { use });

        engine.provide(KEY, value);
        await engine.start();

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(value);
    });

    it('inject in the tools factory', async () => {
        const KEY = defineContextKey<Service>('service');
        const value: Service = { id: 's1' };
        let seen: unknown;
        const { engine, store } = setup(mockModel([text('done')]), (ctx) => {
            seen = inject(ctx, KEY);

            return {};
        });

        engine.provide(KEY, value);
        await engine.start();

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen).toBe(value);
    });

    it('inject in alreadyApplied and effectKey', async () => {
        const KEY = defineContextKey<Service>('service');
        const value: Service = { id: 's1' };
        const seen: Record<string, unknown> = {};
        const apply = defineEffectTool({
            inputSchema: z.object({}),
            effectKey: (_input, ctx) => {
                seen.effectKey = inject(ctx, KEY);

                return 'k1';
            },
            alreadyApplied: async (_key, _input, ctx) => {
                seen.alreadyApplied = inject(ctx, KEY);

                return undefined;
            },
            execute: async () => 'applied',
        });
        const { engine, store } = setup(mockModel([callTool('apply'), text('done')]), { apply });

        engine.provide(KEY, value);
        await engine.start();

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen.effectKey).toBe(value);
        expect(seen.alreadyApplied).toBe(value);
    });

    it('one ToolContext per execution sees the same values', async () => {
        const KEY = defineContextKey<Service>('service');
        const value: Service = { id: 's1' };
        const seen: unknown[] = [];
        const contexts: ToolContext[] = [];
        const { engine, store } = setup(mockModel([callTool('apply'), text('done')]), (ctx) => {
            contexts.push(ctx);
            seen.push(inject(ctx, KEY));

            return {
                apply: defineEffectTool({
                    inputSchema: z.object({}),
                    alreadyApplied: async (_key, _input, hookCtx) => {
                        contexts.push(hookCtx);
                        seen.push(inject(hookCtx, KEY));

                        return undefined;
                    },
                    execute: async (_input, { context }) => {
                        contexts.push(context);
                        seen.push(inject(context, KEY));

                        return 'applied';
                    },
                }),
            };
        });

        engine.provide(KEY, value);
        await engine.start();

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen).toHaveLength(3);

        for (const s of seen) {
            expect(s).toBe(value);
        }

        expect(contexts[1]).toBe(contexts[0]);
        expect(contexts[2]).toBe(contexts[0]);
    });

    it('tryInject returns undefined for a key never provided', async () => {
        const PROVIDED = defineContextKey<Service>('provided');
        const MISSING = defineContextKey<Service>('missing');
        const seen: unknown[] = [];
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(tryInject(context, MISSING), tryInject(context, PROVIDED));

                return 'ok';
            },
        });
        const { engine, store } = setup(mockModel([callTool('use'), text('done')]), { use });
        const value: Service = { id: 's1' };

        engine.provide(PROVIDED, value);
        await engine.start();
        await runOn(engine, store);
        expect(seen).toEqual([undefined, value]);
        expect(seen[1]).toBe(value);
    });

    it('two keys of the same name are independent', async () => {
        const a = defineContextKey<Service>('shared');
        const b = defineContextKey<Service>('shared');
        let caught: unknown;
        const { engine, store } = setup(mockModel([text('done')]), (ctx) => {
            expect(inject(ctx, a)).toEqual({ id: 'a' });

            try {
                inject(ctx, b);
            } catch (error) {
                caught = error;
            }

            return {};
        });

        engine.provide(a, { id: 'a' });
        await engine.start();
        await runOn(engine, store);
        expect(caught).toBeInstanceOf(ContextNotProvidedError);
        expect((caught as Error).message).toContain('Context "shared"');
    });

    it('a value provided after start reaches the next execution', async () => {
        const KEY = defineContextKey<Service>('service');
        const value: Service = { id: 's1' };
        let seen: unknown;
        const { engine, store } = setup(mockModel([text('done')]), (ctx) => {
            seen = inject(ctx, KEY);

            return {};
        });

        await engine.start();
        engine.provide(KEY, value);

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect(seen).toBe(value);
    });

    it('provide refuses a foreign key, undefined and a second value', () => {
        const { engine } = setup(mockModel([]), {});
        const foreign = { name: 'x' } as ContextKey<number>;

        expect(() => engine.provide(foreign, 1)).toThrow(InvalidAgentDefinitionError);
        // a key of another @chamvi/core copy (a package that resolved its own) reads the same
        expect(() => engine.provide(foreign, 1)).toThrow(
            'Context "x" has no key from defineContextKey() of the engine\'s @chamvi/core: ' +
            'a key from another copy of @chamvi/core (a package that resolved its own) is refused.',
        );

        const KEY = defineContextKey<Service | undefined>('service');

        expect(() => engine.provide(KEY, undefined)).toThrow(InvalidAgentDefinitionError);
        expect(() => engine.provide(KEY, undefined)).toThrow('Context "service" needs a value.');

        engine.provide(KEY, { id: 's1' });
        expect(() => engine.provide(KEY, { id: 's2' })).toThrow(InvalidAgentDefinitionError);
        expect(() => engine.provide(KEY, { id: 's2' })).toThrow('Context "service" is already provided.');
    });

    it('a missing value in execute is a tool error', async () => {
        const KEY = defineContextKey<Service>('service');
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                inject(context, KEY);

                return 'ok';
            },
        });
        const model = mockModel([callTool('use'), text('done')]);
        const { engine, store } = setup(model, { use });

        await engine.start();

        const { runId, run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');

        const step = await toolStep(store, runId, 'use');

        expect((step?.error as { code: string } | undefined)?.code).toBe('context_not_provided');
        expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain('Context \\"service\\" is not provided');
    });

    it('a missing value in an effect hook is a tool error', async () => {
        const KEY = defineContextKey<Service>('service');
        let executed = 0;
        const apply = defineEffectTool({
            inputSchema: z.object({}),
            alreadyApplied: async (_key, _input, ctx) => {
                inject(ctx, KEY);

                return undefined;
            },
            execute: async () => {
                executed++;

                return 'applied';
            },
        });
        const { engine, store } = setup(mockModel([callTool('apply'), text('done')]), { apply });

        await engine.start();

        const { runId, run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');

        const step = await toolStep(store, runId, 'apply');

        expect((step?.error as { code: string } | undefined)?.code).toBe('context_not_provided');
        expect(executed).toBe(0);
    });

    it('a missing value in the tools factory fails the run', async () => {
        const KEY = defineContextKey<Service>('service');
        const model = mockModel([text('done')]);
        const {
            engine,
            store,
            errors,
        } = setup(model, (ctx) => {
            inject(ctx, KEY);

            return {};
        });

        await engine.start();

        const { run } = await runOn(engine, store);

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('context_not_provided');
        expect(model.doStreamCalls).toHaveLength(0);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(ContextNotProvidedError);
    });

    it('never stored or serialized', async () => {
        const KEY = defineContextKey<{ secret: string }>('secret');
        const contexts: ToolContext[] = [];
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                contexts.push(context);

                return inject(context, KEY).secret === 'sekr3t-ctx-value' ? 'ok' : 'wrong';
            },
        });
        const { engine, store } = setup(mockModel([callTool('use'), text('done')]), { use });

        engine.provide(KEY, { secret: 'sekr3t-ctx-value' });
        await engine.start();

        const { runId, run } = await runOn(engine, store);

        expect(run?.status).toBe('completed');
        expect((await toolStep(store, runId, 'use'))?.output).toBe('ok');

        const ctx = contexts[0]!;

        expect(Reflect.ownKeys(ctx).map(String).sort()).toEqual(['artifacts', 'channels', 'run', 'state']);

        const secret = 'sekr3t-ctx-value';

        expect(JSON.stringify(ctx.run)).not.toContain(secret);
        expect(JSON.stringify(await store.steps.find(runId))).not.toContain(secret);
        expect(JSON.stringify(await store.checkpoints.findOne(runId))).not.toContain(secret);
        expect(JSON.stringify(await store.runs.findOne(runId))).not.toContain(secret);
    });

    it('the same key on two engines', async () => {
        const KEY = defineContextKey<Service>('service');
        const seen: unknown[] = [];
        const factory = (ctx: ToolContext) => {
            seen.push(inject(ctx, KEY));

            return {};
        };
        const first = setup(mockModel([text('done')]), factory);
        const second = setup(mockModel([text('done')]), factory);
        const one: Service = { id: 'one' };
        const two: Service = { id: 'two' };

        first.engine.provide(KEY, one);
        second.engine.provide(KEY, two);
        await first.engine.start();
        await second.engine.start();
        await runOn(first.engine, first.store);
        await runOn(second.engine, second.store);
        expect(seen).toHaveLength(2);
        expect(seen[0]).toBe(one);
        expect(seen[1]).toBe(two);
    });
});

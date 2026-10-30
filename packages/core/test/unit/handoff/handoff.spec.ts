/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { LanguageModelV4CallOptions } from '@ai-sdk/provider';
import type { ToolSet } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
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
    InvalidRunStateError,
    ValidationError,
    agentChannel,
    approve,
    defineAgent,
    defineTool,
    handoff,
    startHandoff,
} from '@chamvi/core';
import type {
    ChannelSubscription,
    HandoffInput,
    IEngine,
    IStore,
    Invoker,
    Run,
    ToolContext,
} from '@chamvi/core';
import { stableHash } from '../../../src/effect/helpers.ts';
import { MemoryEffectRepository, createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockPart, MockResponse } from '../../utils/mock-model.ts';

const START = new Date(Date.UTC(2026, 9, 27, 6));

const call = (input: unknown, toolCallId?: string, toolName = 'fan'): MockPart => ({
    type: 'tool-call',
    toolName,
    input,
    toolCallId,
});
const turn = (...parts: MockPart[]): MockResponse => ({ parts });
const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

/** True for a run handed off (its first message renders channel `agent`). */
function isChild(options: LanguageModelV4CallOptions): boolean {
    const first = options.prompt.find((m) => m.role === 'user');

    if (!first || typeof first.content === 'string') {
        return false;
    }

    return first.content.some((part) => part.type === 'text' && part.text.includes('"channel": "agent"'));
}

/** The parent's script; every child answers `child done` (and so completes). */
function routedModel(parent: MockResponse[], child: MockResponse[] = []) {
    const parentModel = mockModel(parent);
    const childModel = mockModel([...child, ...Array.from({ length: 50 }, () => text('child done'))]);

    return new MockLanguageModelV4({ doStream: (options) => (isChild(options) ? childModel : parentModel).doStream(options) });
}

const fan = defineTool({
    inputSchema: z.object({
        payload: z.unknown().optional(),
        idempotencyKey: z.string().optional(),
        concurrencyKey: z.string().optional(),
        address: z.string().optional(),
    }),
    execute: async (input, { context }) => startHandoff(context, input as HandoffInput),
});

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

class LossyRepository extends MemoryEffectRepository {
    lose = false;

    override async findOne(key: string) {
        if (this.lose && key.includes(':handoff:')) {
            return undefined;
        }

        return super.findOne(key);
    }
}

/** A store answering one read of a hand-off record late and stale, as a busy pool would: after the record landed, as missing. */
function laggingRepository(): IStore {
    const store = createMemoryStore({ clock: new ControllableClock(START) });
    const read = store.effects.findOne.bind(store.effects);
    const tick = () => new Promise((resolve) => {
        setImmediate(resolve);
    });
    let reads = 0;

    store.effects.findOne = async (key: string) => {
        if (!key.includes(':handoff:')) {
            return read(key);
        }

        reads += 1;

        if (reads !== 2) {
            return read(key);
        }

        for (let i = 0; i < 50 && !(await read(key)); i++) {
            await tick();
        }

        for (let i = 0; i < 5; i++) {
            await tick();
        }

        return undefined;
    };

    return store;
}

function setup(options: {
    parent: MockResponse[];
    child?: MockResponse[];
    subscription?: ChannelSubscription<any> | false;
    tools?: ToolSet;
    store?: IStore;
}) {
    const clock = new ControllableClock(START);
    const store = options.store ?? createMemoryStore({ clock });
    const errors: unknown[] = [];
    const agent = defineAgent({
        name: 'maintainer',
        instructions: 'You maintain.',
        model: routedModel(options.parent, options.child),
        channels: options.subscription === false ? [] : [options.subscription ?? handoff.on()],
        tools: options.tools ?? { fan },
    });
    const engine = new Engine({
        store,
        clock,
        agents: [agent],
        channels: [agentChannel()],
        onError: (error) => {
            errors.push(error);
        },
    });

    engines.push(engine);

    return {
        engine,
        store,
        clock,
        errors,
    };
}

async function dispatchParent(engine: IEngine, extra: { invoker?: Invoker } = {}) {
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'maintainer',
        trigger: 'test',
        channel: 'test',
        payload: {},
        ...extra,
    });

    await engine.idle();

    return runId;
}

async function children(store: IStore): Promise<Run[]> {
    const { data } = await store.runs.find({ agent: 'maintainer' });

    return data.filter((run) => run.trigger.channel === 'agent');
}

async function toolSteps(store: IStore, runId: string) {
    return (await store.steps.find(runId)).filter((step) => step.kind === 'tool');
}

const pr = {
    payload: { pr: 'o/r#5' },
    idempotencyKey: 'o/r#5@2026-10-27',
    concurrencyKey: 'o/r#5',
    address: 'o/r#5',
};

describe('startHandoff()', () => {
    it('starts a run of the same agent', async () => {
        const { engine, store } = setup({ parent: [turn(call(pr)), text('done')] });
        const parentId = await dispatchParent(engine);
        const [child] = await children(store);

        expect(child).toBeDefined();
        expect(child!.trigger).toMatchObject({
            agent: 'maintainer',
            trigger: 'handoff',
            channel: 'agent',
            payload: { pr: 'o/r#5' },
            idempotencyKey: 'handoff:o/r#5@2026-10-27',
            concurrencyKey: 'o/r#5',
            address: 'o/r#5',
            parent: {
                kind: 'handoff',
                runId: parentId,
                agent: 'maintainer',
                depth: 1,
            },
        });
        expect(child!.concurrencyKey).toBe('o/r#5');
        expect(child!.address).toBe('o/r#5');

        const [step] = await toolSteps(store, parentId);

        expect(step?.output).toEqual({ runId: child!.id, deduplicated: false });
        expect((await store.runs.findOne(parentId))?.status).toBe('completed');
    });

    it("inherits the parent's invoker", async () => {
        const invoker: Invoker = {
            id: 'u1',
            kind: 'user',
            permissions: ['*'],
        };
        const { engine, store } = setup({ parent: [turn(call(pr)), text('done')] });

        await dispatchParent(engine, { invoker });

        const [child] = await children(store);

        expect(child!.trigger.invoker).toEqual(invoker);
    });

    it('a second parent with the same key gets the existing child', async () => {
        const store = createMemoryStore({ clock: new ControllableClock(START) });
        const first = setup({ parent: [turn(call(pr)), text('done')], store });

        await dispatchParent(first.engine);
        first.engine.stop();

        const second = setup({ parent: [turn(call(pr)), text('done')], store });
        const secondId = await dispatchParent(second.engine);
        const all = await children(store);

        expect(all).toHaveLength(1);

        const [step] = await toolSteps(store, secondId);

        expect(step?.output).toEqual({ runId: all[0]!.id, deduplicated: true });
        expect(await store.effects.findOne(`handoff-count:${secondId}`)).toMatchObject({ result: { count: 1 } });
    });

    it('the result is recorded', async () => {
        const { engine, store } = setup({ parent: [turn(call(pr)), text('done')] });
        const parentId = await dispatchParent(engine);
        const [child] = await children(store);
        const key = `${parentId}:handoff:${stableHash({
            payload: pr.payload,
            key: 'handoff:o/r#5@2026-10-27',
            concurrencyKey: pr.concurrencyKey,
            address: pr.address,
        })}`;

        expect(await store.effects.findOne(key)).toEqual({ result: { runId: child!.id, deduplicated: false } });
    });

    it('a recorded call returns the record and starts nothing', async () => {
        const { engine, store } = setup({ parent: [turn(call(pr, 'c1')), turn(call(pr, 'c2')), text('done')] });
        const parentId = await dispatchParent(engine);
        const all = await children(store);

        expect(all).toHaveLength(1);

        const steps = await toolSteps(store, parentId);

        expect(steps.map((s) => s.output)).toEqual([
            { runId: all[0]!.id, deduplicated: false },
            { runId: all[0]!.id, deduplicated: false },
        ]);
        expect(await store.effects.findOne(`handoff-count:${parentId}`)).toMatchObject({ result: { count: 1 } });
    });

    it('a lost record still yields one child', async () => {
        const store = { ...createMemoryStore({ clock: new ControllableClock(START) }), effects: new LossyRepository() };

        store.effects.lose = true;

        const { engine } = setup({ parent: [turn(call(pr, 'c1')), turn(call(pr, 'c2')), text('done')], store });
        const parentId = await dispatchParent(engine);
        const all = await children(store);

        expect(all).toHaveLength(1);

        const steps = await toolSteps(store, parentId);

        expect(steps.map((s) => (s.output as { runId: string }).runId)).toEqual([all[0]!.id, all[0]!.id]);
        expect(steps[1]?.output).toEqual({ runId: all[0]!.id, deduplicated: true });
    });

    it('identical calls in one step start one child', async () => {
        const { engine, store } = setup({ parent: [turn(call(pr, 'c1'), call(pr, 'c2')), text('done')] });
        const parentId = await dispatchParent(engine);

        expect(await children(store)).toHaveLength(1);
        expect(await store.effects.findOne(`handoff-count:${parentId}`)).toMatchObject({ result: { count: 1 } });
    });

    it('identical calls in one step share one hand-off on a store with latency', async () => {
        const store = laggingRepository();
        const { engine } = setup({ parent: [turn(call(pr, 'c1'), call(pr, 'c2')), text('done')], store });
        const parentId = await dispatchParent(engine);
        const all = await children(store);

        expect(all).toHaveLength(1);

        const steps = await toolSteps(store, parentId);

        expect(steps.map((s) => s.output)).toEqual([
            { runId: all[0]!.id, deduplicated: false },
            { runId: all[0]!.id, deduplicated: false },
        ]);
        expect(await store.effects.findOne(`handoff-count:${parentId}`)).toMatchObject({ result: { count: 1 } });
    });

    it('a call whose record was lost redoes its hand-off at the limit', async () => {
        const store = { ...createMemoryStore({ clock: new ControllableClock(START) }), effects: new LossyRepository() };

        store.effects.lose = true;

        const { engine } = setup({
            parent: [turn(call(pr, 'c1')), turn(call(pr, 'c2')), text('done')],
            subscription: handoff.on({ maxPerRun: 1 }),
            store,
        });
        const parentId = await dispatchParent(engine);
        const all = await children(store);

        expect(all).toHaveLength(1);

        const steps = await toolSteps(store, parentId);

        expect(steps.map((s) => s.output)).toEqual([
            { runId: all[0]!.id, deduplicated: false },
            { runId: all[0]!.id, deduplicated: true },
        ]);
        expect(await store.effects.findOne(`handoff-count:${parentId}`)).toMatchObject({ result: { count: 1 } });
    });

    it('ignores what tool code wrote to ctx.run', async () => {
        const invoker: Invoker = {
            id: 'low',
            kind: 'user',
            permissions: [],
        };
        const forge = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                const run = context.run as { agent: string, trigger: Run['trigger'] };

                run.agent = 'nobody';
                run.trigger.invoker = {
                    id: 'root',
                    kind: 'user',
                    permissions: ['*'],
                };

                return startHandoff(context, { payload: 1 });
            },
        });
        const { engine, store } = setup({ parent: [turn(call({}, 'c1', 'forge')), text('done')], tools: { forge } });
        const parentId = await dispatchParent(engine, { invoker });
        const [child] = await children(store);

        expect(child!.agent).toBe('maintainer');
        expect(child!.trigger.invoker).toEqual(invoker);
        expect(child!.trigger.parent).toEqual({
            kind: 'handoff',
            runId: parentId,
            agent: 'maintainer',
            depth: 1,
        });
    });

    it('a child that drops its parent from ctx.run still cannot hand off', async () => {
        const orphan = defineTool({
            inputSchema: z.object({ payload: z.unknown() }),
            execute: async (input, { context }) => {
                delete (context.run.trigger as { parent?: unknown }).parent;

                return startHandoff(context, { payload: input.payload });
            },
        });
        const { engine, store } = setup({
            parent: [turn(call({ payload: 1 }, 'c1', 'orphan')), text('done')],
            child: [turn(call({ payload: 2 }, 'c2', 'orphan')), text('child done')],
            tools: { orphan },
        });

        await dispatchParent(engine);
        await engine.idle();

        const all = await children(store);

        expect(all).toHaveLength(1);

        const [step] = await toolSteps(store, all[0]!.id);

        expect(step?.error).toMatchObject({ code: 'validation_error', message: expect.stringMatching(/cannot hand off again/) });
    });

    it.each([0, -1, 1.5, '3'])('refuses a hand-off subscription with maxPerRun %j', (maxPerRun) => {
        expect(() => setup({
            parent: [],
            subscription: {
                channel: 'agent',
                id: 'handoff',
                options: { maxPerRun },
            },
        })).toThrow(InvalidAgentDefinitionError);
    });

    it('a maxPerRun changed after registration is a tool error', async () => {
        const subscription = handoff.on();
        const { engine, store } = setup({ parent: [turn(call(pr)), text('done')], subscription });

        (subscription.options as { maxPerRun: unknown }).maxPerRun = '3';

        const parentId = await dispatchParent(engine);

        expect(await children(store)).toHaveLength(0);

        const [step] = await toolSteps(store, parentId);

        expect(step?.error).toMatchObject({ code: 'invalid_agent_definition' });
    });

    it('without a key the default key is run-scoped', async () => {
        const store = createMemoryStore({ clock: new ControllableClock(START) });
        const first = setup({ parent: [turn(call({ payload: { pr: 'o/r#5' } })), text('done')], store });
        const firstId = await dispatchParent(first.engine);

        first.engine.stop();

        const [child] = await children(store);

        expect(child!.trigger.idempotencyKey).toMatch(new RegExp(`^handoff:${firstId}:[0-9a-f]{64}$`));

        const second = setup({ parent: [turn(call({ payload: { pr: 'o/r#5' } })), text('done')], store });

        await dispatchParent(second.engine);
        expect(await children(store)).toHaveLength(2);
    });

    it('a key over 255 characters is hashed', async () => {
        const { engine, store } = setup({ parent: [turn(call({ payload: 1, idempotencyKey: 'k'.repeat(300) })), text('done')] });

        await dispatchParent(engine);

        const [child] = await children(store);

        expect(child!.trigger.idempotencyKey).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("the subscription's keys apply, the input's win", async () => {
        const subscription = handoff.on<{ pr: string }>({
            concurrencyKey: (p) => `c:${p.pr}`,
            idempotencyKey: (p) => `i:${p.pr}`,
        });
        const { engine, store } = setup({
            parent: [turn(call({ payload: { pr: 'a' } }, 'c1'), call({
                payload: { pr: 'b' },
                idempotencyKey: 'mine',
                concurrencyKey: 'own',
            }, 'c2')), text('done')],
            subscription,
        });

        await dispatchParent(engine);

        const all = await children(store);
        const byPr = Object.fromEntries(all.map((run) => [(run.trigger.payload as { pr: string }).pr, run]));

        expect(byPr.a!.trigger).toMatchObject({ idempotencyKey: 'handoff:i:a', concurrencyKey: 'c:a' });
        expect(byPr.b!.trigger).toMatchObject({ idempotencyKey: 'handoff:mine', concurrencyKey: 'own' });
    });

    it('the payload is parsed by the schema', async () => {
        const subscription = handoff.on({ schema: z.object({ pr: z.string() }).transform((p) => ({ pr: p.pr.toUpperCase() })) });
        const { engine, store } = setup({
            parent: [turn(call({ payload: { pr: 'o/r#5' } }, 'c1'), call({ payload: { pr: 5 } }, 'c2')), text('done')],
            subscription,
        });
        const parentId = await dispatchParent(engine);
        const all = await children(store);

        expect(all.map((run) => run.trigger.payload)).toEqual([{ pr: 'O/R#5' }]);

        const steps = await toolSteps(store, parentId);

        expect(steps.find((s) => s.error)?.error).toMatchObject({ code: 'validation_error' });
    });

    it('the limit counts across executions', async () => {
        const gate = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => approve(context, { title: 'go on?' }),
        });
        const { engine, store } = setup({
            parent: [
                turn(call({ payload: 1 }, 'c1'), call({ payload: 2 }, 'c2')),
                turn(call({}, 'g1', 'gate')),
                turn(call({ payload: 3 }, 'c3')),
                turn(call({ payload: 4 }, 'c4')),
                text('done'),
            ],
            subscription: handoff.on({ maxPerRun: 3 }),
            tools: { fan, gate },
        });
        const parentId = await dispatchParent(engine);
        const paused = await store.runs.findOne(parentId);

        expect(paused?.status).toBe('waiting');
        await engine.approve(parentId, { approvalId: paused!.waiting!.approvalId, approved: true });
        await engine.idle();
        expect((await store.runs.findOne(parentId))?.status).toBe('completed');
        expect(await children(store)).toHaveLength(3);

        const steps = (await toolSteps(store, parentId)).filter((s) => s.name === 'fan');

        expect(steps.at(-1)?.error).toMatchObject({ code: 'validation_error', message: expect.stringMatching(/reached its 3 hand-offs/) });
    });

    it('a child cannot hand off', async () => {
        const { engine, store } = setup({
            parent: [turn(call({ payload: 1 })), text('done')],
            child: [turn(call({ payload: 2 })), text('child done')],
        });

        await dispatchParent(engine);
        await engine.idle();

        const [child] = await children(store);

        expect(await children(store)).toHaveLength(1);

        const [step] = await toolSteps(store, child!.id);

        expect(step?.error).toMatchObject({ code: 'validation_error', message: expect.stringMatching(/cannot hand off again/) });
    });

    it('no subscription', async () => {
        const { engine, store } = setup({ parent: [turn(call({ payload: 1 })), text('done')], subscription: false });
        const parentId = await dispatchParent(engine);
        const [step] = await toolSteps(store, parentId);

        expect(step?.error).toMatchObject({ code: 'validation_error', message: expect.stringMatching(/accepts no hand-offs/) });
        expect(await children(store)).toHaveLength(0);
    });

    it.each([
        [{}, /payload/],
        [{ payload: 1, concurrencyKey: '' }, /concurrency key/],
        [{ payload: 1, idempotencyKey: '' }, /idempotency key/],
        [{ payload: 1, address: 'a\0b' }, /address/],
    ])('refuses the input %j', async (input, message) => {
        const { engine, store } = setup({ parent: [turn(call(input)), text('done')] });
        const parentId = await dispatchParent(engine);
        const [step] = await toolSteps(store, parentId);

        expect(step?.error).toMatchObject({ code: 'validation_error', message: expect.stringMatching(message) });
        expect(await children(store)).toHaveLength(0);
    });

    it('outside a tool call throws InvalidRunStateError', async () => {
        const seen: unknown[] = [];
        const { engine } = setup({
            parent: [text('done')],
            tools: ((ctx: ToolContext) => {
                seen.push(startHandoff(ctx, { payload: 1 }).catch((error: unknown) => error));

                return {};
            }) as never,
        });

        await dispatchParent(engine);
        expect(await seen[0]).toBeInstanceOf(InvalidRunStateError);
    });

    it('a hand-built context has no host', async () => {
        const { engine, store } = setup({
            parent: [turn(call({}, 'c1', 'raw')), text('done')],
            tools: {
                raw: defineTool({
                    inputSchema: z.object({}),
                    execute: async (_input, { context }) => startHandoff({ ...context }, { payload: 1 })
                        .then(() => 'started', (error: unknown) => (error instanceof ContextNotProvidedError ? 'no host' : String(error))),
                }),
            },
        });
        const parentId = await dispatchParent(engine);
        const [step] = await toolSteps(store, parentId);

        expect(step?.output).toBe('no host');
    });

    it('rejects input that is no object', async () => {
        const { engine, store } = setup({
            parent: [turn(call({}, 'c1', 'raw')), text('done')],
            tools: {
                raw: defineTool({
                    inputSchema: z.object({}),
                    execute: async (_input, { context }) => startHandoff(context, 'x' as never)
                        .then(() => 'started', (error: unknown) => (error instanceof ValidationError ? 'refused' : String(error))),
                }),
            },
        });
        const parentId = await dispatchParent(engine);
        const [step] = await toolSteps(store, parentId);

        expect(step?.output).toBe('refused');
    });
});

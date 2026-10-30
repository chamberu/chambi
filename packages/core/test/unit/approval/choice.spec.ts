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
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidRunStateError,
    ValidationError,
    approve,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    ApprovalDecision,
    ApprovalOption,
    ChannelMessage,
    IChannel,
} from '@chamvi/core';
import { toApprovalDecision } from '../../../src/approval/helpers.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const START = 1_000_000;

const engines: Engine[] = [];

afterEach(() => {
    for (const e of engines) e.stop();
    engines.length = 0;
});

const ask = (request: unknown, toolCallId = 'c1'): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName: 'pick',
        input: { request },
        toolCallId,
    }],
});
const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });

const OPTIONS: ApprovalOption[] = [
    { id: 'a', label: 'Alpha' },
    {
        id: 'b',
        label: 'Beta',
        detail: '@@ -1 +1 @@\n-a\n+b',
    },
    { id: 'c', label: 'Gamma' },
];

function setup(model: LanguageModel, channels: IChannel[] = []) {
    const clock = new ControllableClock(new Date(START));
    const store = createMemoryStore({ clock });
    const decisions: ApprovalDecision[] = [];
    const errors: unknown[] = [];
    const pick = defineTool({
        inputSchema: z.object({ request: z.any() }),
        execute: async ({ request }, { context }) => {
            const { via, ...rest } = request;
            const decision = typeof via === 'string' ?
                await context.channels.findOneOrFail(via).approve({ ...rest, address: 'ops' }) :
                await approve(context, request);
            decisions.push(decision);
            return decision.approved ? `picked ${(decision.selected ?? []).join(',')}` : 'denied';
        },
    });
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'release',
            instructions: 'You release.',
            model,
            tools: { pick },
        })],
        channels,
        clock,
        claimTtlMs: 30,
        onError: (error) => {
            errors.push(error);
        },
    });
    engines.push(engine);
    return {
        clock,
        store,
        engine,
        decisions,
        errors,
    };
}

async function dispatch(engine: Engine, store: ReturnType<typeof createMemoryStore>) {
    await engine.start();
    const { runId } = await engine.dispatch({
        agent: 'release',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
    await engine.idle();
    const run = await store.runs.findOne(runId);
    return { runId, run };
}

describe('approve() with options', () => {
    it('stores the options and multiple on the wait point', async () => {
        const model = mockModel([ask({
            title: 'Adopt rules?',
            options: [
                {
                    id: 'unicorn/no-null',
                    label: 'no-null',
                    detail: '@@ -1 +1 @@\n-a\n+b',
                    extra: 1,
                },
                { id: 'b', label: 'B' },
            ],
            multiple: true,
        }), text('done')]);
        const { store, engine } = setup(model);
        const { run } = await dispatch(engine, store);
        expect(run?.status).toBe('waiting');
        expect(run?.waiting?.options).toEqual([
            {
                id: 'unicorn/no-null',
                label: 'no-null',
                detail: '@@ -1 +1 @@\n-a\n+b',
            },
            { id: 'b', label: 'B' },
        ]);
        expect(run?.waiting?.multiple).toBe(true);
    });

    it('keeps a plain wait point free of option keys', async () => {
        const plain = setup(mockModel([ask({ title: 'Deploy?' }), text('done')]));
        const { run } = await dispatch(plain.engine, plain.store);
        expect(Object.keys(run?.waiting ?? {})).not.toContain('options');
        expect(Object.keys(run?.waiting ?? {})).not.toContain('multiple');

        const single = setup(mockModel([ask({
            title: 'Pick?',
            options: OPTIONS,
            multiple: false,
        }), text('done')]));
        const second = await dispatch(single.engine, single.store);
        expect(second.run?.waiting?.options).toEqual(OPTIONS);
        expect(Object.keys(second.run?.waiting ?? {})).not.toContain('multiple');
    });

    const many = (n: number, detail?: string) => Array.from({ length: n }, (_, i) => ({
        id: `o${i}`,
        label: `Option ${i}`,
        ...(detail !== undefined ? { detail } : {}),
    }));

    it.each([
        ['no options', { options: [] }],
        ['21 options', { options: many(21) }],
        ['options not an array', { options: 'a' }],
        ['a duplicate id', { options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] }],
        ['an id with a space', { options: [{ id: 'has space', label: 'A' }] }],
        ['an id of 129 chars', { options: [{ id: 'x'.repeat(129), label: 'A' }] }],
        ['an empty label', { options: [{ id: 'a', label: '' }] }],
        ['a blank label', { options: [{ id: 'a', label: ' '.repeat(3) }] }],
        ['a label with a line break', { options: [{ id: 'a', label: 'a\nb' }] }],
        ['a label of 201 chars', { options: [{ id: 'a', label: 'x'.repeat(201) }] }],
        ['a detail of 20 001 chars', {
            options: [{
                id: 'a',
                label: 'A',
                detail: 'x'.repeat(20_001),
            }],
        }],
        ['details over 100 000 chars', { options: many(6, 'x'.repeat(20_000)) }],
        ['a detail that is no string', {
            options: [{
                id: 'a',
                label: 'A',
                detail: 1,
            }],
        }],
        ['an option that is no object', { options: ['a'] }],
        ['multiple without options', { multiple: true }],
        ['multiple that is no boolean', { options: OPTIONS, multiple: 'yes' }],
        ['a label with a line separator', { options: [{ id: 'a', label: 'a\u2028b' }] }],
        ['a label with a paragraph separator', { options: [{ id: 'a', label: 'a\u2029b' }] }],
        ['a label with an escape', { options: [{ id: 'a', label: '\u001b[31mred' }] }],
        ['a label with a C1 control', { options: [{ id: 'a', label: 'a\u0085b' }] }],
        ['a label with a tab', { options: [{ id: 'a', label: 'a\tb' }] }],
    ])('refuses %s as a tool error', async (_, extra) => {
        const { store, engine } = setup(mockModel([ask({ title: 'Pick?', ...extra }), text('done')]));
        const { runId, run } = await dispatch(engine, store);
        expect(run?.status).toBe('completed');
        expect(run?.waiting).toBeUndefined();
        const tools = (await store.steps.find(runId)).filter((s) => s.kind === 'tool');
        expect(tools[0]).toMatchObject({ name: 'pick', error: { code: 'validation_error' } });
    });

    it('takes multiple: false without options as a plain request', async () => {
        const { store, engine } = setup(mockModel([ask({ title: 'Deploy?', multiple: false }), text('done')]));
        const { run } = await dispatch(engine, store);
        expect(run?.status).toBe('waiting');
        expect(Object.keys(run?.waiting ?? {})).not.toContain('options');
        expect(Object.keys(run?.waiting ?? {})).not.toContain('multiple');
    });

    it('accepts ids such as rule names and versions', async () => {
        const options = [
            { id: '@typescript-eslint/no-explicit-any', label: 'no-explicit-any' },
            { id: '1.2.3', label: 'v1.2.3' },
            { id: 'feat/x', label: 'branch' },
            { id: 'x'.repeat(128), label: 'long' },
        ];
        const { store, engine } = setup(mockModel([ask({ title: 'Pick?', options }), text('done')]));
        const { run } = await dispatch(engine, store);
        expect(run?.waiting?.options).toEqual(options);
    });
});

async function paused(request: unknown) {
    const ctx = setup(mockModel([ask(request), text('done')]));
    const { runId, run } = await dispatch(ctx.engine, ctx.store);
    if (!run?.waiting) throw new Error('not waiting');
    return {
        ...ctx,
        runId,
        waiting: run.waiting,
    };
}

describe('answering an approval with options', () => {
    it('returns the selection in option order', async () => {
        const {
            engine,
            store,
            runId,
            waiting,
            decisions,
        } = await paused({
            title: 'Pick?',
            options: OPTIONS,
            multiple: true,
        });
        await engine.approve(runId, {
            approvalId: waiting.approvalId,
            approved: true,
            selected: ['c', 'a'],
        });
        await engine.idle();
        expect(decisions).toEqual([{ approved: true, selected: ['a', 'c'] }]);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed' });
        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect(wait?.input).toEqual({
            toolCallId: 'c1',
            title: 'Pick?',
            options: OPTIONS,
            multiple: true,
        });
        expect(wait?.output).toMatchObject({ approved: true, selected: ['a', 'c'] });
    });

    it('returns a single selection', async () => {
        const {
            engine,
            runId,
            waiting,
            decisions,
        } = await paused({ title: 'Pick?', options: OPTIONS });
        await engine.approve(runId, {
            approvalId: waiting.approvalId,
            approved: true,
            selected: ['b'],
        });
        await engine.idle();
        expect(decisions).toEqual([{ approved: true, selected: ['b'] }]);
    });

    const SINGLE = { title: 'Pick?', options: OPTIONS };
    const MULTIPLE = {
        title: 'Pick?',
        options: OPTIONS,
        multiple: true,
    };
    const PLAIN = { title: 'Deploy?' };

    it.each([
        ['several ids for a single choice', SINGLE, true, ['a', 'b']],
        ['an unknown id', SINGLE, true, ['z']],
        ['an empty selection of a single choice', SINGLE, true, []],
        ['no selection for a single choice', SINGLE, true, undefined],
        ['an empty selection of a multiple choice', MULTIPLE, true, []],
        ['a selection on a denial', SINGLE, false, ['a']],
        ['a selection on a plain wait point', PLAIN, true, ['a']],
        ['a selection that is no array', SINGLE, true, 'a'],
        ['a duplicate id', MULTIPLE, true, ['a', 'a']],
        ['21 ids', MULTIPLE, true, Array.from({ length: 21 }, (_, i) => `o${i}`)],
        ['an id that is no string', MULTIPLE, true, [1]],
    ])('refuses %s', async (_, request, approved, selected) => {
        const {
            engine,
            store,
            runId,
            waiting,
        } = await paused(request);
        await expect(engine.approve(runId, {
            approvalId: waiting.approvalId,
            approved,
            selected: selected as string[],
        })).rejects.toThrow(ValidationError);
        const run = await store.runs.findOne(runId);
        expect(run?.status).toBe('waiting');
        expect(run?.waiting).toEqual(waiting);
    });

    it('checks the state before the selection', async () => {
        const { engine, runId } = await paused(SINGLE);
        await expect(engine.approve(runId, {
            approvalId: 'stale',
            approved: true,
            selected: ['z'],
        }))
            .rejects.toThrow(InvalidRunStateError);
    });

    it('drops an empty selection on a denial', async () => {
        const {
            engine,
            store,
            runId,
            waiting,
            decisions,
        } = await paused(MULTIPLE);
        await engine.approve(runId, {
            approvalId: waiting.approvalId,
            approved: false,
            reason: 'none',
            selected: [],
        });
        await engine.idle();
        expect(decisions).toEqual([{ approved: false, reason: 'none' }]);
        const effect = await store.effects.findOne(`approval:${runId}:${waiting.approvalId}`);
        expect(effect?.result).toEqual({ approved: false, reason: 'none' });
        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect(Object.keys(wait?.output as object)).not.toContain('selected');
    });

    it('times out without a selection', async () => {
        const {
            engine,
            clock,
            runId,
            decisions,
            store,
        } = await paused({ ...SINGLE, timeoutMs: 1000 });
        clock.advance(1000);
        await engine.tick();
        await engine.idle();
        expect(decisions).toEqual([{ approved: false, reason: 'approval timed out' }]);
        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect(wait?.input).toMatchObject({ options: OPTIONS });
    });

    it('answers a plain wait point without a selected key', async () => {
        const {
            engine,
            store,
            runId,
            waiting,
            decisions,
        } = await paused(PLAIN);
        await engine.approve(runId, { approvalId: waiting.approvalId, approved: true });
        await engine.idle();
        expect(decisions).toEqual([{ approved: true }]);
        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect(wait?.input).toEqual({ toolCallId: 'c1', title: 'Deploy?' });
        expect(Object.keys(wait?.output as object)).not.toContain('selected');
    });

    it('answers a stored plain wait point without options', async () => {
        const request = { title: 'Deploy?' };
        const {
            clock,
            store,
            engine,
            decisions,
        } = setup(mockModel([text('done')]));
        const now = clock.now();
        const runId = 'pre-upgrade';
        const trigger = {
            id: 't-1',
            agent: 'release',
            trigger: 'http',
            channel: 'http',
            payload: {},
            receivedAt: now,
        };
        // a row the code before options wrote: no options or multiple keys
        await store.runs.insert({
            id: runId,
            agent: 'release',
            status: 'waiting',
            trigger,
            waiting: {
                kind: 'approval',
                approvalId: '0:c1:0',
                toolName: 'pick',
                toolCallId: 'c1',
                title: 'Deploy?',
                expiresAt: new Date(now.getTime() + 60_000),
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: now,
            updatedAt: now,
        });
        await store.checkpoints.save({
            runId,
            stepIndex: 0,
            messages: [
                { role: 'user', content: 'start' },
                {
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'pick',
                        input: { request },
                    }],
                },
            ],
            finishReason: 'tool-calls',
            createdAt: now,
        });
        await engine.start();
        await engine.approve(runId, { approvalId: '0:c1:0', approved: true });
        await engine.idle();
        expect(decisions).toEqual([{ approved: true }]);
        expect(Object.keys(decisions[0]!)).not.toContain('selected');
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed' });
        const wait = (await store.steps.find(runId)).find((s) => s.kind === 'wait');
        expect(wait?.output).toMatchObject({ approvalId: '0:c1:0', approved: true });
        expect(Object.keys(wait?.output as object)).not.toContain('selected');
    });

    it('reads a recorded selection back', () => {
        expect(toApprovalDecision({ approved: true, selected: ['b'] })).toEqual({ approved: true, selected: ['b'] });
        expect(toApprovalDecision({ approved: true, selected: 'b' })).toEqual({ approved: true });
        expect(toApprovalDecision({ approved: true, selected: ['b', 1] })).toEqual({ approved: true });
    });
});

describe('delivering an approval with options', () => {
    it('delivers the options through the channel', async () => {
        const sent: ChannelMessage[] = [];
        const rec: IChannel = {
            name: 'rec',
            async out(message) {
                sent.push(message);
            },
        };
        const model = mockModel([
            {
                parts: [
                    {
                        type: 'tool-call',
                        toolName: 'pick',
                        input: {
                            request: {
                                via: 'rec',
                                title: 'Pick?',
                                options: OPTIONS,
                                multiple: true,
                            },
                        },
                        toolCallId: 'c1',
                    },
                ],
            },
            text('done'),
        ]);
        const { engine, store } = setup(model, [rec]);
        await dispatch(engine, store);
        expect(sent).toHaveLength(1);
        expect(sent[0]).toMatchObject({
            kind: 'approval',
            options: OPTIONS,
            multiple: true,
        });

        const plainSent: ChannelMessage[] = [];
        const plain = setup(mockModel([
            {
                parts: [
                    {
                        type: 'tool-call',
                        toolName: 'pick',
                        input: { request: { via: 'rec', title: 'Deploy?' } },
                        toolCallId: 'c1',
                    },
                ],
            },
            text('done'),
        ]), [{
            name: 'rec',
            async out(message) {
                plainSent.push(message);
            },
        }]);
        await dispatch(plain.engine, plain.store);
        expect(plainSent).toHaveLength(1);
        expect(Object.keys(plainSent[0]!)).not.toContain('options');
        expect(Object.keys(plainSent[0]!)).not.toContain('multiple');
    });
});

describe('replaying an answered approval with options', () => {
    /**
     * Two engines over one store: the first answers and runs the pending
     * call, which blocks after approve() returned (the decision is recorded);
     * its clock never moves, so it never renews the claim, which expires on
     * the store's clock and the second engine recovers and runs the call again
     * (a crash or lost lease between the decision write and the call's result).
     */
    async function replay(first: unknown, second: unknown, answer: { approved: boolean; selected?: string[] }) {
        const clock = new ControllableClock(new Date(START));
        const frozen = new ControllableClock(new Date(START));
        const store = createMemoryStore({ clock });
        const decisions: ApprovalDecision[] = [];
        const { promise: gate, resolve: release } = Promise.withResolvers<void>();
        const make = (model: LanguageModel, engineClock: ControllableClock) => {
            const engine = new Engine({
                store,
                clock: engineClock,
                claimTtlMs: 30,
                agents: [defineAgent({
                    name: 'release',
                    instructions: 'You release.',
                    model,
                    tools: {
                        pick: defineTool({
                            inputSchema: z.object({}),
                            execute: async (_input, { context }) => {
                                const decision = await approve(context, (decisions.length === 0 ? first : second) as never);
                                decisions.push(decision);
                                if (decisions.length === 1) await gate;
                                return decision.approved ? 'picked' : 'denied';
                            },
                        }),
                    },
                })],
                onError: () => {},
            });
            engines.push(engine);
            return engine;
        };
        const call: MockResponse = {
            parts: [{
                type: 'tool-call',
                toolName: 'pick',
                input: {},
                toolCallId: 'c1',
            }],
        };
        const stale = make(mockModel([call, text('done')]), frozen);
        await stale.start();
        const { runId } = await stale.dispatch({
            agent: 'release',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await stale.idle();
        const run = await store.runs.findOne(runId);
        if (!run?.waiting) throw new Error('not waiting');
        await stale.approve(runId, { approvalId: run.waiting.approvalId, ...answer });
        await vi.waitFor(() => expect(decisions).toHaveLength(1));

        clock.advance(31);
        const fresh = make(mockModel([text('done')]), clock);
        await fresh.start();
        await fresh.idle();
        release();
        return {
            store,
            runId,
            decisions,
        };
    }

    const MULTIPLE = {
        title: 'Pick?',
        options: OPTIONS,
        multiple: true,
    };

    it('returns the recorded selection on replay', async () => {
        const {
            store,
            runId,
            decisions,
        } = await replay(MULTIPLE, MULTIPLE, { approved: true, selected: ['c', 'a'] });
        expect(decisions).toEqual([
            { approved: true, selected: ['a', 'c'] },
            { approved: true, selected: ['a', 'c'] },
        ]);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed' });
        expect(toApprovalDecision({ approved: true, selected: ['a', 'c'] })).toEqual({ approved: true, selected: ['a', 'c'] });
    });

    it('denies a replayed request whose options no longer hold the selection', async () => {
        const { decisions } = await replay(MULTIPLE, {
            title: 'Pick?',
            options: [{ id: 'a', label: 'Alpha' }],
            multiple: true,
        }, { approved: true, selected: ['a', 'c'] });
        expect(decisions[1]).toEqual({ approved: false, reason: 'options changed' });
    });

    it('denies a replayed request that became a single choice', async () => {
        const { decisions } = await replay(MULTIPLE, { title: 'Pick?', options: OPTIONS }, { approved: true, selected: ['a', 'c'] });
        expect(decisions[1]).toEqual({ approved: false, reason: 'options changed' });
    });

    it('denies a replayed request that became plain', async () => {
        const { decisions } = await replay(MULTIPLE, { title: 'Pick?' }, { approved: true, selected: ['a'] });
        expect(decisions[1]).toEqual({ approved: false, reason: 'options changed' });
    });

    it('denies a replayed request that gained options', async () => {
        const { decisions } = await replay({ title: 'Pick?' }, MULTIPLE, { approved: true });
        expect(decisions[1]).toEqual({ approved: false, reason: 'options changed' });
    });

    it('keeps a recorded denial whatever the replayed request offers', async () => {
        const { decisions } = await replay(MULTIPLE, { title: 'Pick?' }, { approved: false });
        expect(decisions).toEqual([{ approved: false }, { approved: false }]);
    });

    it('keeps the selection when the replayed options still hold it', async () => {
        const { decisions } = await replay(MULTIPLE, {
            title: 'Pick?',
            options: [{ id: 'c', label: 'Gamma' }, { id: 'a', label: 'Alpha' }, { id: 'd', label: 'Delta' }],
            multiple: true,
        }, { approved: true, selected: ['a', 'c'] });
        expect(decisions[1]).toEqual({ approved: true, selected: ['c', 'a'] });
    });
});

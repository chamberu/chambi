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
} from 'vitest';
import { z } from 'zod';
import { Engine, ValidationError, defineAgent } from '@chamvi/core';
import type { IEngine } from '@chamvi/core';
import { EFFECT } from '../../../src/effect/constants.ts';
import { wrapToolsForRun } from '../../../src/effect/wrap.ts';
import { createRunArtifacts } from '../../../src/artifact/module.ts';
import { systemClock } from '../../../src/clock/index.ts';
import type { RunContext } from '../../../src/run/types.ts';
import { createAgentState } from '../../../src/state/module.ts';
import { createStateTools } from '../../../src/state/tools.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { toolContextSchema } from '../../../src/tool/constants.ts';
import type { ToolContext } from '../../../src/tool/types.ts';
import { mockModel } from '../../utils/mock-model.ts';

const schema = {
    items: z.object({ title: z.string(), done: z.boolean() }),
    notes: z.object({ body: z.string() }),
};

const callOpts = { toolCallId: 'c', messages: [] };

function toolContext(store: ReturnType<typeof createMemoryStore>): ToolContext {
    const run: RunContext = {
        runId: 'r1',
        agent: 'alpha',
        trigger: {
            agent: 'alpha',
            trigger: 'http',
            channel: 'http',
            payload: {},
        } as RunContext['trigger'],
        signal: new AbortController().signal,
    };

    return {
        channels: {} as ToolContext['channels'],
        run,
        state: createAgentState('alpha', schema, store.state),
        artifacts: createRunArtifacts(store.artifacts, { id: 'r1', agent: 'alpha' }, systemClock),
    };
}

async function call(tools: ToolSet, name: string, input: unknown, context?: ToolContext) {
    const t = tools[name];

    return (t?.execute as (i: unknown, o: unknown) => Promise<unknown>)(input, { ...callOpts, context });
}

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

async function runOnce(store: ReturnType<typeof createMemoryStore>, agent: Parameters<typeof defineAgent>[0]) {
    const engine = new Engine({
        store,
        agents: [defineAgent(agent)],
        onError: () => {},
    });

    engines.push(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: agent.name,
        trigger: 'http',
        channel: 'http',
        payload: {},
    });

    await engine.idle();

    return runId;
}

describe('agent state', () => {
    it('kv roundtrip is scoped per agent', async () => {
        const store = createMemoryStore();
        const a = createAgentState('alpha', schema, store.state);
        const b = createAgentState('beta', schema, store.state);

        await a.set('cursor', { page: 2 });
        expect(await a.get('cursor')).toEqual({ page: 2 });
        expect(await b.get('cursor')).toBeUndefined();

        await b.set('cursor', 'other');
        expect(await a.get('cursor')).toEqual({ page: 2 });
        expect(await b.get('cursor')).toBe('other');
    });

    it('upsert validates against schema', async () => {
        const store = createMemoryStore();
        const state = createAgentState('alpha', schema, store.state);
        const items = state.collection('items');

        await expect(items.upsert('a', { title: 1 } as never)).rejects.toBeInstanceOf(ValidationError);
        expect(await items.list()).toEqual([]);
        expect(await store.state.findDocuments('alpha', 'items')).toEqual([]);

        await items.upsert('a', { title: 'ok', done: false });
        expect(await items.list()).toEqual([{
            id: 'a',
            title: 'ok',
            done: false,
        }]);
    });

    it('list filters by where', async () => {
        const state = createAgentState('alpha', schema, createMemoryStore().state);
        const items = state.collection('items');

        await items.upsert('a', { title: 'one', done: true });
        await items.upsert('b', { title: 'two', done: false });
        await items.upsert('c', { title: 'three', done: true });

        const done = await items.list({ where: { done: true } });

        expect(done.map((d) => d.id).sort()).toEqual(['a', 'c']);
        expect(await items.list({ where: { done: true }, limit: 1 })).toHaveLength(1);
        expect(await items.list({ where: { title: 'two' } })).toEqual([{
            id: 'b',
            title: 'two',
            done: false,
        }]);
    });

    it('state tools are generated per collection with expected names', async () => {
        const store = createMemoryStore();
        const context = toolContext(store);
        const tools = createStateTools(schema);

        expect(Object.keys(tools).sort()).toEqual([
            'state_items_list',
            'state_items_remove',
            'state_items_upsert',
            'state_notes_list',
            'state_notes_remove',
            'state_notes_upsert',
        ]);
        expect(EFFECT in (tools.state_items_upsert as object)).toBe(true);
        expect(EFFECT in (tools.state_items_remove as object)).toBe(true);
        expect(EFFECT in (tools.state_items_list as object)).toBe(false);
        // every state tool reads the state from the injected context
        expect(Object.values(tools).every((t) => t.contextSchema === toolContextSchema)).toBe(true);

        await call(tools, 'state_items_upsert', { id: 'a', doc: { title: 'x', done: false } }, context);
        expect(await call(tools, 'state_items_list', { where: { done: false } }, context))
            .toEqual([{
                id: 'a',
                title: 'x',
                done: false,
            }]);
        await call(tools, 'state_items_remove', { id: 'a' }, context);
        expect(await call(tools, 'state_items_list', {}, context)).toEqual([]);
        await expect(call(tools, 'state_items_upsert', { id: 'b', doc: { title: 'x' } }, context))
            .rejects.toBeInstanceOf(ValidationError);
    });

    it('repeated writes within a run are not memoized away', async () => {
        const store = createMemoryStore();
        const context = toolContext(store);
        const tools = wrapToolsForRun(createStateTools(schema), context, store.effects);
        const a = { id: 'x', doc: { title: 'a', done: false } };
        const b = { id: 'x', doc: { title: 'b', done: false } };

        await call(tools, 'state_items_upsert', a, context);
        await call(tools, 'state_items_upsert', b, context);
        await call(tools, 'state_items_upsert', a, context);
        expect(await store.state.findDocuments('alpha', 'items')).toEqual([{ id: 'x', doc: a.doc }]);

        await call(tools, 'state_items_remove', { id: 'x' }, context);
        await call(tools, 'state_items_upsert', b, context);
        await call(tools, 'state_items_remove', { id: 'x' }, context);
        expect(await store.state.findDocuments('alpha', 'items')).toEqual([]);
    });

    it('model can upsert via generated tool', async () => {
        const store = createMemoryStore();
        const runId = await runOnce(store, {
            name: 'todo',
            instructions: 'x',
            state: schema,
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'state_items_upsert',
                        input: { id: 'a', doc: { title: 'buy milk', done: false } },
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
        });

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect(await store.state.findDocuments('todo', 'items')).toEqual([
            { id: 'a', doc: { title: 'buy milk', done: false } },
        ]);
    });

    it('user tools win on a name clash', async () => {
        const store = createMemoryStore();
        let userCalls = 0;
        const runId = await runOnce(store, {
            name: 'todo',
            instructions: 'x',
            state: schema,
            tools: () => ({
                state_items_upsert: tool({
                    inputSchema: z.object({ id: z.string() }).passthrough(),
                    execute: async () => ++userCalls,
                }),
            }),
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'state_items_upsert',
                        input: { id: 'a', doc: { title: 'buy milk', done: false } },
                    }],
                },
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'state_notes_upsert',
                        input: { id: 'n', doc: { body: 'hi' } },
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
        });

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect(userCalls).toBe(1);
        expect(await store.state.findDocuments('todo', 'items')).toEqual([]);
        // the other generated tools are still there
        expect(await store.state.findDocuments('todo', 'notes')).toEqual([{ id: 'n', doc: { body: 'hi' } }]);
    });
});

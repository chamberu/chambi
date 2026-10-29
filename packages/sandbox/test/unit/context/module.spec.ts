/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryRepositories,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { AgentDefinition } from '@chamvi/core';
import { createWorkspaceManager, injectSandboxContext, provideSandboxContext } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/model.ts';
import type { MockResponse } from '../../utils/model.ts';
import { createFakeProvider } from '../../utils/provider.ts';

const engines: Engine[] = [];

afterEach(() => {
    for (const engine of engines) engine.stop();
    engines.length = 0;
});

function setup(script: MockResponse[], tools: AgentDefinition['tools']) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryRepositories({ clock });
    const provider = createFakeProvider({ clock });
    const manager = createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
    });
    const model = mockModel(script);
    const errors: unknown[] = [];
    const engine = new Engine({
        repositories: store,
        agents: [defineAgent({
            name: 'coder',
            instructions: 'You code.',
            model,
            tools,
        })],
        clock,
        onError: (error) => { errors.push(error); },
    });
    engines.push(engine);
    manager.attach(engine);
    return {
        engine,
        repositories: store,
        provider,
        manager,
        model,
        errors,
    };
}

async function run(engine: Engine, store: ReturnType<typeof createMemoryRepositories>) {
    const { runId } = await engine.dispatch({
        agent: 'coder',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
    await engine.idle();
    return { runId, run: await store.runs.findOne(runId) };
}

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const call = (toolName: string): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input: {},
    }],
});

describe('sandbox context', () => {
    it('the tools factory offers the injected manager\'s tools', async () => {
        const {
            engine,
            repositories: store,
            provider,
            manager,
        } = setup([call('create_workspace'), text('done')], (ctx) => injectSandboxContext(ctx).tools());
        provideSandboxContext(engine, manager);
        await engine.start();
        const { runId, run: done } = await run(engine, store);
        expect(done?.status).toBe('completed');
        expect(provider.created).toHaveLength(1);
        expect(provider.created[0]?.runId).toBe(runId);
    });

    it('a tool injects the provided manager by identity', async () => {
        const seen: unknown[] = [];
        const use = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(injectSandboxContext(context));
                return 'ok';
            },
        });
        const {
            engine,
            repositories: store,
            manager,
        } = setup([call('use'), text('done')], { use });
        provideSandboxContext(engine, manager);
        await engine.start();
        expect((await run(engine, store)).run?.status).toBe('completed');
        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(manager);
    });

    it('without provide the run fails naming sandbox', async () => {
        const {
            engine,
            repositories: store,
            model,
            errors,
        } = setup([text('done')], (ctx) => injectSandboxContext(ctx).tools());
        await engine.start();
        const { run: failed } = await run(engine, store);
        expect(failed?.status).toBe('failed');
        expect(failed?.error?.code).toBe('context_not_provided');
        expect(failed?.error?.message).toContain('"sandbox"');
        expect(model.doStreamCalls).toHaveLength(0);
        expect(errors).toHaveLength(1);
    });

    it('a second provide throws', () => {
        const { engine, manager } = setup([], {});
        provideSandboxContext(engine, manager);
        expect(() => provideSandboxContext(engine, manager)).toThrow(InvalidAgentDefinitionError);
    });
});

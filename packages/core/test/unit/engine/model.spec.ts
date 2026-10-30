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
import { Engine, defineAgent } from '@chamvi/core';
import type { IModelResolver, ModelRef } from '@chamvi/core';
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

function resolver(resolve: (ref: string) => ReturnType<IModelResolver['resolve']>) {
    const resolved: string[] = [];
    const models: IModelResolver = {
        check: () => {},
        resolve: (ref) => {
            resolved.push(ref);

            return resolve(ref);
        },
    };

    return { models, resolved };
}

async function runAgent(options: {
    model?: ModelRef,
    default?: ModelRef,
    models?: IModelResolver
}) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const agent = defineAgent({
        name: 'ops',
        instructions: 'You operate.',
        ...(options.model === undefined ? {} : { model: options.model }),
    });
    const engine = new Engine({
        store,
        agents: [agent],
        clock,
        claimTtlMs: 30,
        model: options.default,
        models: options.models,
        onError: () => {},
    });

    engines.push(engine);
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

describe('model resolution at execution start', () => {
    it('a string ref runs what the resolver returns', async () => {
        const { models, resolved } = resolver(() => mockModel([text('ok')]));
        const { run } = await runAgent({ model: 'router/cc/claude-opus-4-6', models });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('ok');
        expect(resolved).toEqual(['router/cc/claude-opus-4-6']);
    });

    it('an agent without model runs the default', async () => {
        const { models, resolved } = resolver(() => mockModel([text('default')]));
        const { run } = await runAgent({ default: 'openai/gpt-5', models });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('default');
        expect(resolved).toEqual(['openai/gpt-5']);
    });

    it('an agent without model runs a default model object', async () => {
        const { run } = await runAgent({ default: mockModel([text('object')]) });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('object');
    });

    it('a throwing resolve() fails the run before any model call', async () => {
        const { models } = resolver(() => {
            throw new Error('No such model: router/missing');
        });
        const { run, steps } = await runAgent({ model: 'router/missing', models });

        expect(run?.status).toBe('failed');
        expect(run?.error?.code).toBe('invalid_agent_definition');
        expect(run?.error?.message).toBe('Model "router/missing" could not be resolved: No such model: router/missing');
        expect(steps.filter((s) => s.kind === 'llm')).toHaveLength(0);
    });

    it('an object ref never reaches the resolver', async () => {
        const { models, resolved } = resolver(() => mockModel([text('wrong')]));
        const { run } = await runAgent({
            model: mockModel([text('own')]),
            default: 'openai/gpt-5',
            models,
        });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('own');
        expect(resolved).toEqual([]);
    });

    it('without a resolver an object runs and a string never reaches a run', async () => {
        const { run } = await runAgent({ model: mockModel([text('plain')]) });

        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('plain');
        await expect(runAgent({ model: 'anthropic/m' })).rejects.toThrow(
            'Agent "ops" uses the model string "anthropic/m", but the engine has no model resolver (EngineOptions.models); pass a LanguageModel object.',
        );
    });
});

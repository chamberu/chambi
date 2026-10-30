/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { LanguageModel, ToolSet } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import { z } from 'zod';
import {
    Engine,
    FatalToolError,
    InvalidAgentDefinitionError,
    ToolDeniedError,
    defineAgent,
    defineContextKey,
    defineEffectTool,
    defineTool,
    inject,
} from '@chamvi/core';
import type { AgentDefinition, AgentHooks, IEngine } from '@chamvi/core';
import { currentToolCall } from '../../../src/effect/frame.ts';
import { stableHash } from '../../../src/effect/helpers.ts';
import { createMemoryStore } from '../../../src/repository/index.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/mock-model.ts';
import type { MockResponse } from '../../utils/mock-model.ts';

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const call = (toolName: string, input: unknown = {}): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
    }],
});

const engines: IEngine[] = [];

afterEach(() => {
    for (const e of engines) {
        e.stop();
    }

    engines.length = 0;
});

async function runOnce(
    model: LanguageModel,
    definition: Partial<AgentDefinition>,
    setup?: (engine: IEngine) => void,
) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStore({ clock });
    const engine = new Engine({
        store,
        agents: [defineAgent({
            name: 'ops',
            instructions: 'You operate.',
            model,
            ...definition,
        })],
        clock,
        onError: () => {},
    });

    engines.push(engine);
    setup?.(engine);
    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'ops',
        trigger: 'test',
        channel: 'test',
        payload: {},
    });

    await engine.idle();

    const steps = await store.steps.find(runId);

    return {
        runId,
        store,
        run: await store.runs.findOne(runId),
        tools: steps.filter((step) => step.kind === 'tool'),
    };
}

describe('agent hooks', () => {
    it('beforeToolExecution sees every tool, state tools included, inside the call frame', async () => {
        const key = defineContextKey<string>('greeting');
        const seen: unknown[] = [];
        const hooks: AgentHooks = {
            beforeToolExecution(info, ctx) {
                seen.push({
                    tool: info.toolName,
                    frame: currentToolCall()?.toolName,
                    id: info.toolCallId === currentToolCall()?.toolCallId,
                    injected: inject(ctx, key),
                });

                return info.input;
            },
        };
        const plain = tool({ inputSchema: z.object({}), execute: async () => 'ok' });
        const { run } = await runOnce(
            mockModel([call('plain'), call('state_notes_list'), text('done')]),
            {
                tools: { plain },
                state: { notes: z.object({ text: z.string() }) },
                hooks,
            },
            (engine) => engine.provide(key, 'hi'),
        );

        expect(run?.status).toBe('completed');
        expect(seen).toEqual([
            {
                tool: 'plain',
                frame: 'plain',
                id: true,
                injected: 'hi',
            },
            {
                tool: 'state_notes_list',
                frame: 'state_notes_list',
                id: true,
                injected: 'hi',
            },
        ]);
    });

    it('a rewritten input reaches execute and is re-validated', async () => {
        const executed: unknown[] = [];
        const count = tool({
            inputSchema: z.object({ n: z.number() }),
            execute: async (input) => {
                executed.push(input);

                return 'ok';
            },
        });
        const hooks: AgentHooks = {
            beforeToolExecution: ({ input }) => {
                const { n } = input as { n: number };

                return n === 1 ? { n: 2 } : { n: 'x' };
            },
        };
        const { run, tools } = await runOnce(
            mockModel([call('count', { n: 1 }), call('count', { n: 5 }), text('done')]),
            { tools: { count }, hooks },
        );

        expect(run?.status).toBe('completed');
        expect(executed).toEqual([{ n: 2 }]);
        expect(tools[1]?.error).toMatchObject({ code: 'validation_error' });
        expect(String((tools[1]?.error as { message: string }).message)).toContain('count');
    });

    it('a thrown ToolDeniedError is a tool error, the run goes on', async () => {
        const executed: unknown[] = [];
        const bash = tool({
            inputSchema: z.object({}),
            execute: async () => {
                executed.push(1);

                return 'ok';
            },
        });
        const { run, tools } = await runOnce(mockModel([call('bash'), text('done')]), {
            tools: { bash },
            hooks: {
                beforeToolExecution: ({ toolName }) => {
                    throw new ToolDeniedError(`${toolName} is not for you.`);
                },
            },
        });

        expect(run?.status).toBe('completed');
        expect(executed).toEqual([]);
        expect(tools[0]?.error).toEqual({ code: 'tool_denied', message: 'bash is not for you.' });
    });

    it('a thrown FatalToolError fails the run', async () => {
        const bash = tool({ inputSchema: z.object({}), execute: async () => 'ok' });
        const { run } = await runOnce(mockModel([call('bash'), text('done')]), {
            tools: { bash },
            hooks: {
                beforeToolExecution: () => {
                    throw new FatalToolError('stop everything');
                },
            },
        });

        expect(run?.status).toBe('failed');
        expect(run?.error).toMatchObject({ message: 'stop everything' });
    });

    it('the effect key is computed from the rewritten input', async () => {
        const post = defineEffectTool({
            inputSchema: z.object({ body: z.string() }),
            execute: async ({ body }) => body,
        });
        const {
            run,
            runId,
            store,
        } = await runOnce(mockModel([call('post', { body: 'x' }), text('done')]), {
            tools: { post },
            hooks: { beforeToolExecution: () => ({ body: 'y' }) },
        });

        expect(run?.status).toBe('completed');
        expect(await store.effects.findOne(`${runId}:post:${stableHash({ body: 'y' })}`)).toEqual({ result: 'y' });
        expect(await store.effects.findOne(`${runId}:post:${stableHash({ body: 'x' })}`)).toBeUndefined();
    });

    it('afterToolExecution rewrites a fresh result and a recorded effect result alike', async () => {
        let executions = 0;
        const after: unknown[] = [];
        const post = defineEffectTool({
            inputSchema: z.object({ body: z.string() }),
            execute: async ({ body }) => {
                executions += 1;

                return `secret ${body}`;
            },
        });
        const { run, tools } = await runOnce(
            mockModel([call('post', { body: 'x' }), call('post', { body: 'x' }), text('done')]),
            {
                tools: { post },
                hooks: {
                    afterToolExecution: (info) => {
                        after.push(info);

                        return String(info.output).replace('secret', '[redacted]');
                    },
                },
            },
        );

        expect(run?.status).toBe('completed');
        expect(executions).toBe(1);
        expect(tools.map((step) => step.output)).toEqual(['[redacted] x', '[redacted] x']);
        expect(after[0]).toMatchObject({
            toolName: 'post',
            input: { body: 'x' },
            output: 'secret x',
        });
    });

    it('afterToolExecution is not called for a tool error', async () => {
        const after: unknown[] = [];
        const broken = defineTool({
            inputSchema: z.object({}),
            execute: async (): Promise<string> => {
                throw new Error('boom');
            },
        });
        const { run, tools } = await runOnce(mockModel([call('broken'), text('done')]), {
            tools: { broken },
            hooks: {
                afterToolExecution: (info) => {
                    after.push(info);

                    return info.output;
                },
            },
        });

        expect(run?.status).toBe('completed');
        expect(tools[0]?.error).toMatchObject({ message: 'boom' });
        expect(after).toEqual([]);
    });

    it('a streaming tool\'s afterToolExecution gets the final value', async () => {
        const after: unknown[] = [];
        const stream = tool({
            inputSchema: z.object({}),
            async* execute() {
                yield 'one';
                yield 'two';
            },
        });
        const { run, tools } = await runOnce(mockModel([call('stream'), text('done')]), {
            tools: { stream },
            hooks: {
                afterToolExecution: ({ output }) => {
                    after.push(output);

                    return `final ${String(output)}`;
                },
            },
        });

        expect(run?.status).toBe('completed');
        expect(after).toEqual(['two']);
        expect(tools[0]?.output).toBe('final two');
    });

    it('defineAgent refuses a tool with needsApproval', () => {
        const gated = tool({
            inputSchema: z.object({}),
            needsApproval: true,
            execute: async () => 'ok',
        });

        expect(() => defineAgent({
            name: 'ops',
            instructions: 'x',
            model: mockModel([]),
            tools: { gated },
        })).toThrow(InvalidAgentDefinitionError);
    });

    it('a factory set with needsApproval fails the run before any model call', async () => {
        const gated = tool({
            inputSchema: z.object({}),
            needsApproval: () => true,
            execute: async () => 'ok',
        });
        const { run } = await runOnce(mockModel([]), { tools: (): ToolSet => ({ gated }) });

        expect(run?.status).toBe('failed');
        expect(run?.error).toMatchObject({ code: 'invalid_agent_definition' });
        expect(String((run?.error as { message: string }).message)).toContain('gated');
    });
});

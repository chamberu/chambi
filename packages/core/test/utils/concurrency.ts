/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import {
    Engine,
    createMemoryStores,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { Agent, ChannelSubscription, EngineOptions } from '@chamvi/core';
import { ControllableClock } from './clock.ts';
import { MockLanguageModelV4 } from 'ai/test';

export const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

export function concurrencyHarness() {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryStores({ clock });
    const engines: Engine[] = [];
    const releases = new Map<string, () => void>();
    const entered: string[] = [];
    const errors: unknown[] = [];
    function agent(name = 'worker', cap?: number | false, channels: ChannelSubscription[] = []) {
        return defineAgent({
            name,
            instructions: 'Hold one tool call.',
            concurrencyMaxRuns: cap,
            channels,
            budget: { maxSteps: 1 },
            model: new MockLanguageModelV4({
                doStream: async () => ({
                    stream: new ReadableStream({
                        start(controller) {
                            controller.enqueue({ type: 'stream-start', warnings: [] });
                            controller.enqueue({
                                type: 'tool-call',
                                toolCallId: 'hold',
                                toolName: 'hold',
                                input: '{}',
                            });
                            controller.enqueue({
                                type: 'finish',
                                finishReason: { unified: 'tool-calls', raw: undefined },
                                usage: {
                                    inputTokens: {
                                        total: 1,
                                        noCache: 1,
                                        cacheRead: undefined,
                                        cacheWrite: undefined,
                                    },
                                    outputTokens: {
                                        total: 1,
                                        text: 1,
                                        reasoning: undefined,
                                    },
                                },
                            });
                            controller.close();
                        },
                    }),
                }),
            }),
            tools: (ctx) => ({
                hold: defineTool({
                    description: 'Wait until released.',
                    inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
                    execute: async () => {
                        entered.push(ctx.run.runId);
                        await new Promise<void>((resolve) => {
                            releases.set(ctx.run.runId, resolve);
                            ctx.run.signal.addEventListener('abort', () => resolve(), { once: true });
                        });
                        return 'released';
                    },
                }),
            }),
        });
    }
    function engine(agents: Agent[], options: Partial<EngineOptions> = {}) {
        const instance = new Engine({
            stores: store,
            clock,
            agents,
            channels: [{ name: 'input' }],
            owner: `replica-${engines.length}`,
            concurrencyMaxRuns: 20,
            onError: (error) => { errors.push(error); },
            ...options,
        });
        engines.push(instance);
        return instance;
    }
    async function dispatch(instance: Engine, trigger = 'a', extra = {}) {
        clock.advance(1);
        return instance.dispatch({
            agent: 'worker',
            channel: 'input',
            trigger,
            payload: {},
            ...extra,
        });
    }
    async function settle() {
        for (let i = 0; i < 20; i++) await flush();
    }
    async function close() {
        const drains = engines.map((instance) => instance.drain({ timeoutMs: 1 }));
        await settle();
        clock.advance(1);
        for (const release of releases.values()) release();
        await Promise.all(drains);
    }
    return {
        clock,
        stores: store,
        engines,
        releases,
        entered,
        errors,
        agent,
        engine,
        dispatch,
        settle,
        close,
    };
}

export const subscription = (id: string, concurrencyMaxRuns?: number | false): ChannelSubscription => ({
    channel: 'input',
    id,
    options: {},
    concurrencyMaxRuns,
});

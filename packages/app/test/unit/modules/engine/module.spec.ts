/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    AGENT_CHANNEL_NAME,
    InvalidAgentDefinitionError,
    createMemoryRepositories,
    defineAgent,
    defineTool,
    handoff,
    resolveModel,
} from '@chamvi/core';
import { http, httpChannel } from '@chamvi/http';
import type {
    Agent,
    Engine,
    IChannel,
    ModelRef,
} from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { customProvider, generateText, jsonSchema } from 'ai';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import {
    afterEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    AppToken,
    ModuleName,
    configModule,
    consoleChannelModule,
    engineModule,
    repositoryModule,
} from '@chamvi/app';
import type { AppMode, ILifecycleHook } from '@chamvi/app';
import { buildHarness } from '../../../utils/harness.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import { approvalModel, textModel } from '../../../utils/model.ts';


function agentWith(model: Agent['definition']['model'], extra: Partial<Parameters<typeof defineAgent>[0]> = {}): Agent {
    return defineAgent({
        name: 'triage',
        model,
        instructions: 'triage',
        ...extra,
    });
}

/** A module contributing to a collection token in setup. */
function contributing(name: string, register: (container: IContainer) => void): IModule {
    return {
        name,
        async setup(container) {
            register(container);
        },
    };
}

let harnesses: Harness[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
});

function build(options: {
    mode?: AppMode;
    agents: Agent[];
    env?: Record<string, string>;
    modules?: IModule[];
    models?: Record<string, ReturnType<typeof customProvider>>;
    model?: ModelRef;
    repositories?: ReturnType<typeof createMemoryRepositories>;
}) {
    const clock = new ControllableClock(new Date('2026-10-21T00:00:00Z'));
    const logger = createRecordingLogger(clock);
    const harness = buildHarness({
        mode: options.mode,
        env: { ...options.env },
        agents: options.agents,
        models: options.models,
        model: options.model,
        modules: [
            configModule({ clock, logger }),
            repositoryModule(options.repositories ? { repositories: options.repositories } : {}),
            engineModule(),
            ...(options.modules ?? []),
        ],
    });
    harnesses.push(harness);
    return {
        harness,
        clock,
        logger,
    };
}

async function dispatch(engine: Engine) {
    return engine.dispatch({
        agent: 'triage',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a rejection');
}

describe('engineModule', () => {
    it('is named and depends on config and store', () => {
        const module = engineModule();
        expect(module.name).toBe(ModuleName.ENGINE);
        expect(module.dependencies).toEqual([ModuleName.CONFIG, ModuleName.STORE]);
    });

    it('start mode builds and starts the engine', async () => {
        const { harness } = build({ agents: [agentWith(textModel('triaged'))] });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        const run = await engine.getRun(runId);
        expect(run?.status).toBe('completed');
        expect(run?.output).toBe('triaged');
    });

    it('job mode builds but does not start', async () => {
        const { harness } = build({ mode: 'job', agents: [agentWith(textModel())] });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('queued');
    });

    it('migrate mode builds nothing', async () => {
        const { harness } = build({
            mode: 'migrate',
            agents: [agentWith('anthropic/m')],
            env: { DATABASE_URL: 'postgres://u@127.0.0.1:1/x' },
            // a given store: the module never connects
            repositories: createMemoryRepositories(),
        });
        await harness.setup();

        expect(harness.container.has(AppToken.ENGINE)).toBe(false);
        // the agent channel is contributed in start and job mode only
        const channels = harness.container.has(AppToken.CHANNELS) ? harness.container.resolveAll(AppToken.CHANNELS) : [];
        expect(channels.map((channel) => channel.name)).not.toContain('agent');
    });

    it('channels come from every CHANNELS contribution', async () => {
        const agent = agentWith(textModel(), { channels: [http.on()] });
        const { harness } = build({
            agents: [agent],
            modules: [contributing('http', (container) => {
                container.registerMany(AppToken.CHANNELS, { useValue: httpChannel() });
            })],
        });
        await harness.setup();
        expect(harness.container.resolve(AppToken.ENGINE).getChannel('http')?.name).toBe('http');

        const without = build({ agents: [agent] });
        const error = await rejectionOf(without.harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('Agent "triage" subscribes to unknown channel "http".');
    });

    it.each(['start', 'job'] as const)('contributes the agent channel in %s mode', async (mode) => {
        const agent = agentWith(textModel(), { channels: [handoff.on()] });
        const { harness } = build({ mode, agents: [agent] });
        await harness.setup();
        const names = harness.container.resolveAll(AppToken.CHANNELS).map((channel) => channel.name);
        expect(names).toContain(AGENT_CHANNEL_NAME);
        expect(harness.container.resolve(AppToken.ENGINE).getChannel('agent')?.name).toBe('agent');
    });

    it('a user channel named agent clashes', async () => {
        const { harness } = build({
            agents: [],
            modules: [contributing('mine', (container) => {
                container.registerMany(AppToken.CHANNELS, { useValue: { name: 'agent', out: async () => undefined } });
            })],
        });
        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('The channel "agent" is registered more than once.');
    });

    it('duplicate channel names throw', async () => {
        const { harness } = build({
            agents: [agentWith(textModel())],
            modules: [
                consoleChannelModule({ write: () => undefined }),
                contributing('second', (container) => {
                    container.registerMany(AppToken.CHANNELS, { useValue: { name: 'console', out: async () => undefined } });
                }),
            ],
        });

        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('The channel "console" is registered more than once.');
    });

    it('engineCreated hooks run before start, drained after drain', async () => {
        const events: string[] = [];
        const hook: ILifecycleHook = {
            name: 'recorder',
            engineCreated: (engine) => {
                events.push(`engineCreated:${engine.listAgents().length}`);
                // the engine is not started yet: a run dispatched here waits for start()
                const original = engine.start.bind(engine);
                engine.start = async () => {
                    events.push('start');
                    await original();
                };
                const drain = engine.drain.bind(engine);
                engine.drain = async (input) => {
                    await drain(input);
                    events.push('drain');
                };
            },
            drained: () => {
                events.push('drained');
            },
        };
        const { harness } = build({
            agents: [agentWith(textModel())],
            modules: [contributing('hooks', (container) => {
                container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
            })],
        });
        await harness.setup();
        expect(events).toEqual(['engineCreated:1', 'start']);

        await harness.stop();
        expect(events).toEqual(['engineCreated:1', 'start', 'drain', 'drained']);
    });

    it('a string model resolves through models', async () => {
        const model = textModel('from fake');
        const { harness } = build({
            agents: [agentWith('anthropic/m')],
            models: { anthropic: customProvider({ languageModels: { m: model } }) },
        });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.output).toBe('from fake');
        expect(model.doStreamCalls).toHaveLength(1);
    });

    it('CHAMVI_MODEL gives an agent without model its model', async () => {
        const model = textModel('from default');
        const { harness } = build({
            agents: [agentWith(undefined)],
            env: { CHAMVI_MODEL: 'test/m' },
            models: { test: customProvider({ languageModels: { m: model } }) },
        });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.output).toBe('from default');
    });

    it('CHAMVI_MODEL overrides the code default', async () => {
        const fromEnv = textModel('from env');
        const fromCode = textModel('from code');
        const { harness } = build({
            agents: [agentWith(undefined)],
            env: { CHAMVI_MODEL: 'test/env' },
            model: 'test/code',
            models: { test: customProvider({ languageModels: { env: fromEnv, code: fromCode } }) },
        });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.output).toBe('from env');
        expect(fromCode.doStreamCalls).toHaveLength(0);
    });

    it('a code default model serves an agent without model', async () => {
        const { harness } = build({
            agents: [agentWith(undefined)],
            model: textModel('from code object'),
        });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.output).toBe('from code object');
    });

    it('a code agent on an unconfigured provider fails setup naming the variable', async () => {
        const { harness } = build({ agents: [agentWith('anthropic/m')] });
        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('ANTHROPIC_API_KEY');
        expect(error.message).toContain('CHAMVI_PROVIDER_ANTHROPIC_TYPE');
    });

    it('an agent without model and no default fails setup', async () => {
        const { harness } = build({ agents: [agentWith(undefined)] });
        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('CHAMVI_MODEL');
    });

    it('every settings issue fails setup in one error', async () => {
        const { harness } = build({
            agents: [agentWith(textModel())],
            env: {
                CHAMVI_PROVIDER_ROUTR_API_KEY: 'k',
                CHAMVI_PROVIDER_LOCAL_TYPE: 'nope',
            },
        });
        const error = await rejectionOf(harness.setup());
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toContain('CHAMVI_PROVIDER_ROUTR_API_KEY');
        expect(error.message).toContain('CHAMVI_PROVIDER_LOCAL_TYPE');
        expect(error.message).not.toContain('"k"');
    });

    it('never touches the global provider', async () => {
        const sentinel = customProvider({ languageModels: {} });
        globalThis.AI_SDK_DEFAULT_PROVIDER = sentinel;
        try {
            const { harness } = build({
                agents: [agentWith('test/m')],
                models: { test: customProvider({ languageModels: { m: textModel() } }) },
            });
            await harness.setup();
            expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(sentinel);
            await harness.stop();
            expect(globalThis.AI_SDK_DEFAULT_PROVIDER).toBe(sentinel);
        } finally {
            globalThis.AI_SDK_DEFAULT_PROVIDER = undefined;
        }
    });

    it('a tool resolves a model string through the app resolver', async () => {
        const inner = textModel('inner answer');
        let answer: string | undefined;
        const ask = defineTool({
            description: 'asks another model',
            inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
            execute: async (_input, { context }) => {
                const result = await generateText({ model: resolveModel(context, 'test/inner'), prompt: 'hi' });
                answer = result.text;
                return answer;
            },
        });
        const { harness } = build({
            agents: [agentWith('test/outer', { tools: { ask } })],
            models: {
                test: customProvider({
                    languageModels: {
                        outer: approvalModel('ask'),
                        inner,
                    },
                }),
            },
        });
        await harness.setup();

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await dispatch(engine);
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('completed');
        expect(answer).toBe('inner answer');
        expect(inner.doGenerateCalls).toHaveLength(1);
    });

    it('engine errors go to the logger', async () => {
        const failing: IChannel = {
            name: 'boom',
            start: async () => undefined,
            stop: async () => {
                throw new Error('channel down');
            },
        };
        const { harness, logger } = build({
            agents: [agentWith(textModel())],
            modules: [contributing('boom', (container) => {
                container.registerMany(AppToken.CHANNELS, { useValue: failing });
            })],
        });
        await harness.setup();
        // the drain stops the channels first; a failing stop is reported and the drain goes on
        await harness.stop();

        const entry = logger.entries.find((e) => e.level === 'error' && e.msg === 'engine error');
        expect(JSON.stringify(entry)).toContain('channel down');
    });
});

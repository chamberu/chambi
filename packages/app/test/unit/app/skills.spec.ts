/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import { preparationInput } from '../../utils/skill-runtime.ts';
import { mockModel, textModel } from '@chamvi/test-kit';
import { cron } from '@chamvi/channel-cron';
import { customProvider } from 'ai';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    AppToken,
    configModule,
    createApp,
    storeModule,
} from '@chamvi/app';
import type { AppOptions, IApp, IModule } from '@chamvi/app';
import { TOKENS, deferred, rejectionOf } from '../../utils/app.ts';
import { agentFile } from '../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../utils/folder.ts';
import { closeServer, freePort, listenOn } from '../../utils/port.ts';

const apps: IApp[] = [];
const folders: Awaited<ReturnType<typeof createTempDir>>[] = [];

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    await Promise.all(folders.map((folder) => folder.remove()));
    apps.length = 0;
    folders.length = 0;
});

function build(options: Partial<AppOptions> = {}) {
    const model = mockModel([{ parts: [{ type: 'text', text: 'done' }] }, { parts: [{ type: 'text', text: 'done' }] }]);
    const store = createMemoryStore();
    let engine: Engine | undefined;
    const events: string[] = [];
    const observe: IModule = {
        name: 'observe',
        async setup(container) {
            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                useValue: {
                    name: 'observe',
                    engineCreated(value) {
                        engine = value;
                        events.push('engineCreated');
                    },
                    started() {
                        events.push('started');
                    },
                },
            });
            container.registerMany(AppToken.CHANNELS, {
                useValue: {
                    name: 'probe',
                    async start() {
                        events.push('channel');
                    },
                },
            });
        },
    };
    const app = createApp({
        agents: [defineAgent({
            name: 'code',
            model,
            instructions: 'Work',
        })],
        models: { test: customProvider({ languageModels: { model } }) },
        ...options,
        modules: [configModule(), storeModule({ store }), observe, ...options.modules ?? []],
    });
    apps.push(app);
    return {
        app,
        model,
        store,
        events,
        engine: () => engine,
    };
}

async function environment(extra: Record<string, string> = {}) {
    const port = await freePort();
    return {
        port,
        env: {
            HOST: '127.0.0.1',
            PORT: String(port),
            CHAMVI_TOKENS: TOKENS,
            ...extra,
        },
    };
}

async function folder() {
    const dir = await createTempDir();
    folders.push(dir);
    return dir.path;
}

describe('app skills lifecycle', () => {
    it('code verification failure prevents hooks, channels and HTTP', async () => {
        const source = preparationInput(async () => {
            throw new InvalidAgentDefinitionError('preparation failed');
        });
        const ctx = build({ skills: [source] });
        const { env, port } = await environment();
        await expect(ctx.app.start({ env })).rejects.toBeInstanceOf(InvalidAgentDefinitionError);
        expect(ctx.events).toEqual([]);
        expect(ctx.model.doStreamCalls).toHaveLength(0);
        const probe = await listenOn(port);
        await closeServer(probe);
    });

    it('runJob prepares before engineCreated and model execution', async () => {
        const entered = deferred();
        const release = deferred();
        const source = preparationInput(async () => {
            entered.resolve();
            await release.promise;
        });
        const model = textModel();
        const ctx = build({
            skills: [source],
            agents: [defineAgent({
                name: 'job',
                model,
                instructions: 'Work',
                channels: [cron.on('0 * * * *')],
            })],
        });
        const { env } = await environment();
        const job = ctx.app.runJob({ agent: 'job', env });
        await entered.promise;
        expect(ctx.events).toEqual([]);
        expect(model.doStreamCalls).toHaveLength(0);
        release.resolve();
        await expect(job).resolves.toMatchObject({ status: 'completed', exitCode: 0 });
        expect(ctx.events).toEqual(['engineCreated']);
        expect(JSON.stringify(model.doStreamCalls[0]?.prompt)).toContain('review');
    });

    it('waits for verification before engineCreated, channels, HTTP and model work', async () => {
        const entered = deferred();
        const release = deferred();
        const source = preparationInput(async () => {
            entered.resolve();
            await release.promise;
        });
        const ctx = build({ skills: [source] });
        const { env, port } = await environment();
        const waiting = new Engine({ store: ctx.store, agents: [...ctx.app.agents] });
        const { runId } = await waiting.dispatch({
            agent: 'code',
            channel: 'http',
            trigger: 'http',
            payload: {},
        });
        const starting = ctx.app.start({ env });
        await Promise.race([entered.promise, starting.then(() => { throw new Error('source was skipped'); })]);
        expect(ctx.events).toEqual([]);
        expect(ctx.model.doStreamCalls).toHaveLength(0);
        const probe = await listenOn(port);
        await closeServer(probe);
        release.resolve();
        await starting;
        expect(ctx.events).toEqual(['engineCreated', 'channel', 'started']);
        const engine = ctx.engine()!;
        await engine.idle();
        expect((await engine.getRun(runId))?.status).toBe('completed');
        expect(JSON.stringify(ctx.model.doStreamCalls[0]?.prompt)).toContain('review');
        expect(ctx.model.doStreamCalls[0]?.tools?.map((tool) => tool.name)).toContain('contributed');
    });

    it('adds app defaults to folder agents as well as code agents', async () => {
        const root = await folder();
        await writeTree(root, { 'folder/agent.ts': agentFile('Folder work', 'test/model', 'folder') });
        const ctx = build({ skills: [preparationInput()] });
        const { env } = await environment({ CHAMVI_AGENTS_DIR: root });
        await ctx.app.start({ env });
        const engine = ctx.engine()!;
        for (const agent of ['code', 'folder']) {
            const { runId } = await engine.dispatch({
                agent,
                channel: 'http',
                trigger: 'http',
                payload: {},
            });
            await engine.idle();
            expect((await engine.getRun(runId))?.status).toBe('completed');
        }
        expect(ctx.model.doStreamCalls).toHaveLength(2);
        for (const call of ctx.model.doStreamCalls) {
            expect(JSON.stringify(call.prompt)).toContain('review');
            expect(call.tools?.map((tool) => tool.name)).toContain('contributed');
        }
    });

    it.each(['check', 'migrate'] as const)('%s never loads sources', async (mode) => {
        let calls = 0;
        const source = preparationInput(async () => {
            calls++;
            throw new Error('must stay static');
        });
        const ctx = build({
            skills: [source],
            agents: [defineAgent({
                name: 'code',
                model: textModel(),
                instructions: 'Work',
                skills: [source],
            })],
        });
        const { env } = await environment();
        await ctx.app[mode]({ env: { ...env, DATABASE_URL: 'postgres://u@127.0.0.1:1/x' } });
        expect(calls).toBe(0);
        expect(ctx.model.doStreamCalls).toHaveLength(0);
    });

    it('stop during channel startup prevents later channels from starting', async () => {
        const entered = deferred();
        const release = deferred();
        const channels: string[] = [];
        const gates: IModule = {
            name: 'gated-channels',
            async setup(container) {
                container.registerMany(AppToken.CHANNELS, {
                    useValue: {
                        name: 'blocked',
                        async start() {
                            entered.resolve();
                            await release.promise;
                        },
                        async stop() {
                            channels.push('blocked-stopped');
                        },
                    },
                });
                container.registerMany(AppToken.CHANNELS, {
                    useValue: {
                        name: 'late',
                        async start() {
                            channels.push('late-started');
                        },
                    },
                });
            },
        };
        const ctx = build({ modules: [gates] });
        const { env } = await environment();
        const started = rejectionOf(ctx.app.start({ env }));
        await entered.promise;
        const stopping = ctx.app.stop();
        release.resolve();
        expect((await started).code).toBe('app_stopped');
        await stopping;
        expect(channels).toEqual(['blocked-stopped']);
    });

    it('stop joins a source that ignores cancellation before teardown', async () => {
        const entered = deferred();
        const release = deferred();
        let sourceSignal: AbortSignal | undefined;
        const source = preparationInput(async (signal) => {
            sourceSignal = signal;
            entered.resolve();
            await release.promise;
        });
        const ctx = build({ skills: [source] });
        const { env, port } = await environment();
        const starting = ctx.app.start({ env });
        const started = rejectionOf(starting);
        void started.catch(() => {});
        await Promise.race([entered.promise, starting.then(() => { throw new Error('source was skipped'); })]);
        let stopped = false;
        const stopping = ctx.app.stop().then(() => { stopped = true; });
        await vi.waitFor(() => expect(sourceSignal?.aborted).toBe(true));
        expect(stopped).toBe(false);
        expect(ctx.events).toEqual([]);
        release.resolve();
        expect((await started).code).toBe('app_stopped');
        await stopping;
        expect(ctx.events).toEqual([]);
        expect(ctx.model.doStreamCalls).toHaveLength(0);
        const probe = await listenOn(port);
        await closeServer(probe);
    });
});

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    InvalidAgentDefinitionError,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type { Agent, Engine } from '@chamvi/core';
import { injectSandboxContext, provideSandboxContext } from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { z } from 'zod';
import {
    AppToken,
    configModule,
    engineModule,
    storeModule,
} from '@chamvi/app';
import type { AppMode, ILifecycleHook, IModule } from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';
import type { ModuleHarness } from '@chamvi/app/testing';
import { SandboxModule, sandboxModule } from '@chamvi/sandbox/module';
import type { SandboxModuleOptions, SandboxProviderName } from '@chamvi/sandbox/module';
import { mockModel, textModel } from '../../utils/model.ts';
import { createRecordingLogger, rejectionOf } from '../../utils/module.ts';

/** Records which provider the module imports instead of importing it. */
class RecordingSandboxModule extends SandboxModule {
    imported: SandboxProviderName[] = [];

    constructor(options: SandboxModuleOptions, protected failure?: Error) {
        super(options);
    }

    protected override async importProvider(name: SandboxProviderName): Promise<ISandboxProvider> {
        this.imported.push(name);
        if (this.failure) {
            throw this.failure;
        }
        return {
            name,
            create: async () => { throw new Error('not used'); },
            collectGarbage: async () => 0,
        };
    }
}

function fakeManager(events: string[]): IWorkspaceManager & { engines: unknown[] } {
    const engines: unknown[] = [];
    return {
        engines,
        acquire: async () => { throw new Error('not used'); },
        get: () => { throw new Error('not used'); },
        release: async () => undefined,
        attach(engine) {
            engines.push(engine);
            events.push('attach');
            return () => { events.push('detach'); };
        },
        tools: () => ({}),
        collectGarbage: async () => 0,
        close: async () => { events.push('close'); },
    };
}

function agent(extra: Partial<Parameters<typeof defineAgent>[0]> = {}): Agent {
    return defineAgent({
        name: 'coder',
        model: textModel(),
        instructions: 'code',
        ...extra,
    });
}

let harnesses: ModuleHarness[] = [];
let roots: string[] = [];
let managers: IWorkspaceManager[] = [];

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
    await Promise.all(managers.map((manager) => manager.close()));
    managers = [];
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    roots = [];
});

async function harnessWith(module: IModule, options: {
    mode?: AppMode;
    agents?: Agent[];
    events?: string[]
} = {}) {
    const harness = await createModuleHarness({
        mode: options.mode ?? 'start',
        env: {},
        agents: options.agents ?? [agent()],
        modules: [
            configModule({ logger: createRecordingLogger() }),
            storeModule(),
            engineModule(),
            module,
        ],
    });
    harnesses.push(harness);
    return harness;
}

/** Records `drain` into `events` when the engine module drains the engine (C5: before the manager closes). */
function recordDrain(engine: Engine, events: string[]): void {
    const drain = engine.drain.bind(engine);
    engine.drain = async (options) => {
        events.push('drain');
        return drain(options);
    };
}

describe('sandboxModule', () => {
    it('local by default, exposes the manager synchronously', async () => {
        const module = new RecordingSandboxModule({ env: {} });
        expect(module.name).toBe('chamvi:sandbox');
        expect(typeof module.manager.acquire).toBe('function');
        expect(module.imported).toEqual([]);

        await harnessWith(module);
        expect(module.imported).toEqual(['local']);
    });

    it('the provider option names the provider', async () => {
        const module = new RecordingSandboxModule({ env: {}, provider: 'docker' });
        await harnessWith(module);
        expect(module.imported).toEqual(['docker']);
    });

    it('env wins over the option', async () => {
        const module = new RecordingSandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'docker' }, provider: 'local' });
        await harnessWith(module);
        expect(module.imported).toEqual(['docker']);
    });

    it('an unknown CHAMVI_SANDBOX_PROVIDER names it', () => {
        expect(() => sandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'podman' } }))
            .toThrow(new InvalidAgentDefinitionError('CHAMVI_SANDBOX_PROVIDER must be one of local, docker, kubernetes.'));
    });

    it('kubernetes without namespace names CHAMVI_SANDBOX_NAMESPACE', () => {
        expect(() => sandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'kubernetes' } }))
            .toThrow(InvalidAgentDefinitionError);
        expect(() => sandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'kubernetes' } }))
            .toThrow('CHAMVI_SANDBOX_NAMESPACE');
        expect(() => sandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'kubernetes', CHAMVI_SANDBOX_NAMESPACE: 'sandbox' } }))
            .not.toThrow();
        expect(() => sandboxModule({
            env: {},
            provider: 'kubernetes',
            namespace: 'sandbox',
        })).not.toThrow();
    });

    it('a missing provider package fails setup', async () => {
        const failure = Object.assign(new Error('Cannot find package \'@chamvi/sandbox-k8s\''), { code: 'ERR_MODULE_NOT_FOUND' });
        const module = new RecordingSandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'kubernetes', CHAMVI_SANDBOX_NAMESPACE: 'sb' } }, failure);

        const error = await rejectionOf(harnessWith(module));
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('CHAMVI_SANDBOX_PROVIDER=kubernetes needs @chamvi/sandbox-k8s installed.');
    });

    it('a module missing inside an installed provider package is kept', async () => {
        const failure = Object.assign(new Error('Cannot find package \'dockerode\' imported from /app/node_modules/@chamvi/sandbox-docker/dist/index.mjs'), { code: 'ERR_MODULE_NOT_FOUND' });
        const module = new RecordingSandboxModule({ env: { CHAMVI_SANDBOX_PROVIDER: 'docker' } }, failure);

        expect(await rejectionOf(harnessWith(module))).toBe(failure);
    });

    it('another load failure is kept', async () => {
        const module = new RecordingSandboxModule({ env: {} }, new Error('boom'));
        const error = await rejectionOf(harnessWith(module));
        expect(error.message).toBe('boom');
    });

    it('attach on engineCreated, close after drained', async () => {
        const events: string[] = [];
        const manager = fakeManager(events);
        const harness = await harnessWith(sandboxModule({ manager, env: {} }));

        const engine: Engine = harness.container.resolve(AppToken.ENGINE);
        expect(manager.engines).toEqual([engine]);
        expect(events).toEqual(['attach']);
        recordDrain(engine, events);

        await harness.stop();
        expect(events).toEqual(['attach', 'drain', 'detach', 'close']);
    });

    it('job mode attaches too', async () => {
        const events: string[] = [];
        const harness = await harnessWith(sandboxModule({ manager: fakeManager(events), env: {} }), { mode: 'job' });
        expect(events).toEqual(['attach']);
        recordDrain(harness.container.resolve(AppToken.ENGINE), events);
        await harness.stop();
        expect(events).toEqual(['attach', 'drain', 'detach', 'close']);
    });

    it('migrate mode loads nothing', async () => {
        const module = new RecordingSandboxModule({ env: {} });
        const harness = await createModuleHarness({
            mode: 'migrate',
            env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' },
            modules: [configModule({ logger: createRecordingLogger() }), module],
        });
        harnesses.push(harness);
        expect(module.imported).toEqual([]);
        expect(harness.container.resolveAll(AppToken.LIFECYCLE_HOOKS)).toEqual([]);
    });

    it('a given manager is used as is', () => {
        const manager = fakeManager([]);
        expect(sandboxModule({ manager, env: { CHAMVI_SANDBOX_PROVIDER: 'docker' } }).manager).toBe(manager);
    });

    it('a given provider is used as is', async () => {
        const root = await mkdtemp(join(tmpdir(), 'chamvi-sandbox-module-'));
        roots.push(root);
        const module = sandboxModule({ env: {}, provider: createLocalSandbox({ root }) });
        const { workspace } = await module.manager.acquire('run-1', {});
        expect(workspace.info.provider).toBe('local');
        await module.manager.close();
    });

    it('local end to end', async () => {
        const root = await mkdtemp(join(tmpdir(), 'chamvi-sandbox-module-'));
        roots.push(root);
        const module = sandboxModule({ env: {}, provider: createLocalSandbox({ root }) });
        const coder = agent({
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'create_workspace',
                        input: {},
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
            tools: module.manager.tools(),
        });
        const harness = await harnessWith(module, { agents: [coder] });

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await engine.dispatch({
            agent: 'coder',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await engine.idle();

        const run = await engine.getRun(runId);
        expect(run?.status).toBe('completed');
        const steps = await engine.store.listSteps(runId);
        const created = steps.find((step) => step.kind === 'tool');
        expect(created?.output).toMatchObject({ root: '/workspace', reused: false });

        // attach disposed the completed run's workspace
        await vi.waitFor(async () => {
            expect(await readdir(root)).toEqual([]);
        });
    });

    it('provides the manager as context', async () => {
        const module = sandboxModule({ manager: fakeManager([]), env: {} });
        const seen: boolean[] = [];
        const probe = defineTool({
            inputSchema: z.object({}),
            execute: async (_input, { context }) => {
                seen.push(injectSandboxContext(context) === module.manager);
                return 'ok';
            },
        });
        const coder = agent({
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'probe',
                        input: {},
                    }],
                },
                { parts: [{ type: 'text', text: 'done' }] },
            ]),
            tools: { probe },
        });
        const harness = await harnessWith(module, { agents: [coder] });

        const engine = harness.container.resolve(AppToken.ENGINE);
        const { runId } = await engine.dispatch({
            agent: 'coder',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await engine.idle();

        expect((await engine.getRun(runId))?.status).toBe('completed');
        expect(seen).toEqual([true]);
    });

    it('reports a refused provide instead of failing setup', async () => {
        // provides the sandbox context before the module's own engineCreated hook runs
        const earlier: IModule = {
            name: 'earlier',
            async setup(container) {
                const hook: ILifecycleHook = {
                    name: 'earlier',
                    engineCreated: (engine) => provideSandboxContext(engine, fakeManager([])),
                };
                container.registerMany(AppToken.LIFECYCLE_HOOKS, { useValue: hook });
            },
        };
        const harness = await createModuleHarness({
            env: {},
            agents: [agent()],
            modules: [
                configModule({ logger: createRecordingLogger() }),
                storeModule(),
                engineModule(),
                earlier,
                sandboxModule({ manager: fakeManager([]), env: {} }),
            ],
        });
        harnesses.push(harness);

        expect(harness.reported).toHaveLength(1);
        expect(harness.reported[0]!.error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((harness.reported[0]!.error as Error).message).toBe('Context "sandbox" is already provided.');
        expect(harness.reported[0]!.context).toEqual({ hook: 'chamvi:sandbox', phase: 'engineCreated' });
    });

    it('the real local provider loads', async () => {
        const module = sandboxModule({ env: {} });
        managers.push(module.manager);
        await harnessWith(module);

        const { workspace } = await module.manager.acquire('run-1', {});
        expect(workspace.info.provider).toBe('local');
    });
});

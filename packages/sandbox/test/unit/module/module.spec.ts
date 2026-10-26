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
    MemoryStore,
    defineAgent,
    defineTool,
} from '@chamvi/core';
import type {
    Agent,
    Engine,
    IStore,
    Run,
} from '@chamvi/core';
import { createWorkspaceManager, injectSandboxContext, provideSandboxContext } from '@chamvi/sandbox';
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
import { GC_INTERVAL_MS } from '../../../src/manager/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel, textModel } from '../../utils/model.ts';
import { createRecordingLogger, rejectionOf } from '../../utils/module.ts';

/** Records which provider the module imports instead of importing it. */
class RecordingSandboxModule extends SandboxModule {
    imported: SandboxProviderName[] = [];

    /** Every find and collectGarbage call of the provider it builds. */
    calls: Array<[string, unknown]> = [];

    /** Rejects the next collectGarbage call of the provider with this error. */
    gcFailure: Error | undefined;

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
            find: async (_runId, options) => {
                this.calls.push(['find', options]);
                return [];
            },
            collectGarbage: async (options) => {
                this.calls.push(['collectGarbage', options]);
                const failure = this.gcFailure;
                this.gcFailure = undefined;
                if (failure) throw failure;
                return 0;
            },
        };
    }

    collections(): number {
        return this.calls.filter(([kind]) => kind === 'collectGarbage').length;
    }
}

function fakeManager(events: string[]): IWorkspaceManager & { engines: unknown[]; closes: unknown[] } {
    const engines: unknown[] = [];
    const closes: unknown[] = [];
    return {
        engines,
        closes,
        acquire: async () => { throw new Error('not used'); },
        get: async () => { throw new Error('not used'); },
        release: async () => undefined,
        attach(engine) {
            engines.push(engine);
            events.push('attach');
            return () => { events.push('detach'); };
        },
        tools: () => ({}),
        collectGarbage: async () => 0,
        close: async (options) => {
            closes.push(options);
            events.push('close');
        },
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
    events?: string[];
    store?: IStore;
    clock?: ControllableClock;
} = {}) {
    const harness = await createModuleHarness({
        mode: options.mode ?? 'start',
        env: {},
        agents: options.agents ?? [agent()],
        modules: [
            configModule({ logger: createRecordingLogger(), ...(options.clock && { clock: options.clock }) }),
            storeModule(options.store ? { store: options.store } : {}),
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

describe('sandboxModule: garbage collection timer', () => {
    function clock(): ControllableClock {
        return new ControllableClock(new Date(1_000_000));
    }

    it('collects garbage every GC_INTERVAL_MS in start mode', async () => {
        const time = clock();
        const module = new RecordingSandboxModule({ env: {} });
        await harnessWith(module, { clock: time });
        const before = module.collections();

        time.advance(GC_INTERVAL_MS - 1);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(module.collections()).toBe(before);

        time.advance(1);
        await vi.waitFor(() => expect(module.collections()).toBe(before + 1));

        time.advance(GC_INTERVAL_MS);
        await vi.waitFor(() => expect(module.collections()).toBe(before + 2));
    });

    it('runs no collector in job mode', async () => {
        const time = clock();
        const module = new RecordingSandboxModule({ env: {} });
        await harnessWith(module, { clock: time, mode: 'job' });
        const before = module.collections();

        time.advance(2 * GC_INTERVAL_MS);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(module.collections()).toBe(before);
    });

    it('stops the collector once drained', async () => {
        const time = clock();
        const module = new RecordingSandboxModule({ env: {} });
        const harness = await harnessWith(module, { clock: time });
        await harness.stop();
        const before = module.collections();

        time.advance(2 * GC_INTERVAL_MS);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(module.collections()).toBe(before);
    });

    it('runs no collector with gcIntervalMs 0', async () => {
        const time = clock();
        const module = new RecordingSandboxModule({ env: {}, gcIntervalMs: 0 });
        await harnessWith(module, { clock: time });
        const before = module.collections();

        time.advance(2 * GC_INTERVAL_MS);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(module.collections()).toBe(before);
    });

    it('reports a failing collection and keeps collecting', async () => {
        const time = clock();
        const module = new RecordingSandboxModule({ env: {} });
        const harness = await harnessWith(module, { clock: time });
        const failure = new Error('collection failed');
        module.gcFailure = failure;
        const before = module.collections();

        time.advance(GC_INTERVAL_MS);
        await vi.waitFor(() => expect(harness.reported.map((report) => report.error)).toContain(failure));

        time.advance(GC_INTERVAL_MS);
        await vi.waitFor(() => expect(module.collections()).toBe(before + 2));
    });
});

describe('sandboxModule: image allow-list', () => {
    function dockerProvider(): ISandboxProvider {
        return {
            name: 'docker',
            create: async () => { throw new Error('not used'); },
            find: async () => [],
            collectGarbage: async () => 0,
        };
    }

    function imageParameterOf(module: SandboxModule): boolean {
        const tool = module.manager.tools().create_workspace as { inputSchema: { jsonSchema: { properties: Record<string, unknown> } } };
        return 'image' in tool.inputSchema.jsonSchema.properties;
    }

    it('offers no image without an allow-list', () => {
        const module = sandboxModule({ provider: dockerProvider(), env: {} });
        expect(imageParameterOf(module)).toBe(false);
    });

    it('builds the allow-list from CHAMVI_SANDBOX_IMAGES', async () => {
        const module = sandboxModule({ provider: dockerProvider(), env: { CHAMVI_SANDBOX_IMAGES: ' python:3.13 ,rust:1,' } });
        managers.push(module.manager);
        expect(imageParameterOf(module)).toBe(true);
        await expect(module.manager.acquire('r1', { image: 'node:24' })).rejects.toThrow('image not allowed.');
    });

    it('names CHAMVI_SANDBOX_IMAGES for an entry that is no image reference, never echoing it', () => {
        let error: unknown;
        try {
            sandboxModule({ provider: dockerProvider(), env: { CHAMVI_SANDBOX_IMAGES: 'ok:1,bad image' } });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toContain('CHAMVI_SANDBOX_IMAGES');
        expect((error as Error).message).not.toContain('bad image');
    });

    it('lets CHAMVI_SANDBOX_IMAGES win over allowImage', async () => {
        const allowImage = vi.fn(() => true);
        const module = sandboxModule({
            provider: dockerProvider(),
            allowImage,
            env: { CHAMVI_SANDBOX_IMAGES: 'python:3.13' },
        });
        managers.push(module.manager);
        await expect(module.manager.acquire('r1', { image: 'node:24' })).rejects.toThrow('image not allowed.');
        expect(allowImage).not.toHaveBeenCalled();
    });
});

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

    it('disposes the held workspaces after drained when the store is a MemoryStore', async () => {
        // nothing resumes a run of a memory store after the restart
        const manager = fakeManager([]);
        await (await harnessWith(sandboxModule({ manager, env: {} }))).stop();
        expect(manager.closes).toEqual([{ dispose: true }]);
    });

    it('keeps the held workspaces after drained when the store persists', async () => {
        const memory = new MemoryStore();
        // a store of its own kind: the runs outlive the process
        const store = new Proxy({}, {
            get: (_target, key) => {
                const value: unknown = Reflect.get(memory, key);
                return typeof value === 'function' ? value.bind(memory) : value;
            },
        }) as IStore;
        const manager = fakeManager([]);
        await (await harnessWith(sandboxModule({ manager, env: {} }), { store })).stop();
        expect(manager.closes).toEqual([{ dispose: false }]);
    });

    it('a MemoryStore app disposes a live run\'s workspace on stop', async () => {
        const root = await mkdtemp(join(tmpdir(), 'chamvi-sandbox-module-'));
        roots.push(root);
        const module = sandboxModule({
            env: {}, 
            provider: createLocalSandbox({ root }), 
            gcIntervalMs: 0, 
        });
        const harness = await harnessWith(module);
        const { workspace } = await module.manager.acquire('run-1', {});
        expect(await readdir(root)).toHaveLength(1);
        await harness.stop();
        expect(workspace.disposed).toBe(true);
        expect(await readdir(root)).toEqual([]);
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
        await module.manager.release('run-1');
    });

    it('CHAMVI_DEPLOYMENT wins over the deployment option', async () => {
        const module = new RecordingSandboxModule({ env: { CHAMVI_DEPLOYMENT: 'prod' }, deployment: 'ci' });
        await harnessWith(module);
        await expect(module.manager.get('r1')).rejects.toThrow(/create_workspace/);
        expect(module.calls[0]).toEqual(['find', { deployment: 'prod' }]);

        const other = new RecordingSandboxModule({ env: {}, deployment: 'ci' });
        await harnessWith(other);
        await other.manager.get('r1').catch(() => undefined);
        expect(other.calls[0]).toEqual(['find', { deployment: 'ci' }]);
    });

    it('an invalid CHAMVI_DEPLOYMENT fails the factory', () => {
        expect(() => sandboxModule({ env: { CHAMVI_DEPLOYMENT: 'not valid' } })).toThrow(InvalidAgentDefinitionError);
    });

    it('answers isSettled through the engine: with the default deployment only a settled run is settled', async () => {
        // another app sharing the host in deployment `default` holds runs this engine never saw
        const module = new RecordingSandboxModule({ env: {} });
        const harness = await harnessWith(module);
        await module.manager.collectGarbage();
        const [, options] = module.calls.find(([name]) => name === 'collectGarbage')!;
        const { isSettled } = options as { isSettled(runId: string): Promise<boolean> };

        const engine: Engine = harness.container.resolve(AppToken.ENGINE);
        expect(await isSettled('missing')).toBe(false);
        const getRun = vi.spyOn(engine, 'getRun');
        getRun.mockResolvedValueOnce({ status: 'waiting' } as Run);
        expect(await isSettled('r1')).toBe(false);
        getRun.mockResolvedValueOnce({ status: 'cancelled' } as Run);
        expect(await isSettled('r1')).toBe(true);
    });

    it('a GC with the default deployment keeps the workspaces of runs another app holds', async () => {
        const root = await mkdtemp(join(tmpdir(), 'chamvi-module-shared-'));
        try {
            const other = createWorkspaceManager({ provider: createLocalSandbox({ root }), gcIntervalMs: 0 });
            const { workspace } = await other.acquire('run-of-another-app', {});

            const module = new SandboxModule({
                env: {}, 
                provider: createLocalSandbox({ root }), 
                gcIntervalMs: 0, 
            });
            managers.push(module.manager);
            await harnessWith(module);
            expect(await module.manager.collectGarbage()).toBe(0);

            expect(workspace.disposed).toBe(false);
            expect((await workspace.exec(['true'])).exitCode).toBe(0);
            await other.release('run-of-another-app');
            await other.close();
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    it('answers isSettled through the engine: with an explicit deployment a missing or settled run is settled', async () => {
        const module = new RecordingSandboxModule({ env: { CHAMVI_DEPLOYMENT: 'prod' } });
        const harness = await harnessWith(module);
        await module.manager.collectGarbage();
        const [, options] = module.calls.find(([name]) => name === 'collectGarbage')!;
        const { isSettled } = options as { isSettled(runId: string): Promise<boolean> };

        const engine: Engine = harness.container.resolve(AppToken.ENGINE);
        expect(await isSettled('missing')).toBe(true);
        const getRun = vi.spyOn(engine, 'getRun');
        getRun.mockResolvedValueOnce({ status: 'waiting' } as Run);
        expect(await isSettled('r1')).toBe(false);
        getRun.mockResolvedValueOnce({ status: 'cancelled' } as Run);
        expect(await isSettled('r1')).toBe(true);
    });

    it('answers isSettled false before the engine exists', async () => {
        const module = new RecordingSandboxModule({ env: {} });
        await module.manager.collectGarbage();
        const [, options] = module.calls.find(([name]) => name === 'collectGarbage')!;
        const { isSettled } = options as { isSettled(runId: string): Promise<boolean> };
        expect(await isSettled('missing')).toBe(false);
    });
});

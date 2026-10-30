/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
    Engine,
    InvalidAgentDefinitionError,
    createMemoryStore,
    defineAgent,
} from '@chamvi/core';
import type { Agent, IStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { customProvider } from 'ai';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import {
    AgentsModule,
    AppToken,
    ModuleName,
    agentsModule,
    configModule,
    createApp,
    engineModule,
    hashAgentFolder,
    runHooks,
    storeModule,
} from '@chamvi/app';
import type { AppMode, IApp } from '@chamvi/app';
import {
    TOKEN,
    TOKENS,
    hangingModel,
    rejectionOf,
} from '../../../utils/app.ts';
import { NO_AGENTS_MESSAGE } from '../../../../src/modules/agents/constants.ts';
import { agentFile, cronTrigger } from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import { buildHarness } from '../../../utils/harness.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import { mockModel, textModel } from '../../../utils/model.ts';
import { freePort } from '../../../utils/port.ts';

const START = new Date('2026-10-22T00:00:00Z');
const POLL_MS = 1_000;

function provider() {
    const answers = Array.from({ length: 20 }, () => ({ parts: [{ type: 'text' as const, text: 'from folder' }] }));
    return customProvider({ languageModels: { model: mockModel(answers), hang: hangingModel() } });
}

function codeAgent(name: string): Agent {
    return defineAgent({
        name,
        model: textModel('from code'),
        instructions: 'x',
    });
}

/** A queued run of `name`, dispatched through an engine that never starts. */
async function queueRun(store: IStore, clock: ControllableClock, name: string): Promise<string> {
    const engine = new Engine({
        store,
        clock,
        agents: [codeAgent(name)],
    });
    const { runId } = await engine.dispatch({
        agent: name,
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
    return runId;
}

let root: { path: string; remove: () => Promise<void> };
let harnesses: Harness[] = [];
let apps: IApp[] = [];

beforeEach(async () => {
    root = await createTempDir();
});

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    harnesses = [];
    apps = [];
    await root.remove();
});

function build(options: {
    mode?: AppMode;
    dir?: string;
    store?: IStore;
    clock?: ControllableClock;
    agents?: Agent[];
    env?: Record<string, string>;
} = {}) {
    const clock = options.clock ?? new ControllableClock(START);
    const logger = createRecordingLogger(clock);
    const store = options.store ?? createMemoryStore({ clock });
    const module = new AgentsModule();
    const dir = options.dir ?? root.path;
    const harness = buildHarness({
        mode: options.mode,
        env: {
            CHAMVI_AGENTS_DIR: dir,
            CHAMVI_AGENTS_POLL_MS: String(POLL_MS),
            ...options.env,
        },
        agents: options.agents,
        models: { test: provider() },
        modules: [
            configModule({ clock, logger }),
            storeModule({ store }),
            engineModule(),
            module,
        ],
    });
    harnesses.push(harness);

    const engine = () => harness.container.resolve(AppToken.ENGINE);
    return {
        harness,
        clock,
        logger,
        store,
        engine,
        issues: () => harness.container.resolve(AppToken.AGENT_ISSUES)(),
        /** start mode: runs the `started` hooks (the http module's serve step does in an app). */
        watch: () => runHooks(harness.container, 'started'),
        /** One poll interval, then waits for the poll it started. */
        poll: async () => {
            clock.advance(POLL_MS);
            await module.idle();
        },
    };
}

const folder = (name = 'greeter') => join(root.path, name);

describe('agentsModule', () => {
    it('is named and depends on config and engine', () => {
        const module = agentsModule();
        expect(module.name).toBe(ModuleName.AGENTS);
        expect(module.dependencies).toEqual([ModuleName.CONFIG, ModuleName.ENGINE]);
    });

    it('loads the folder at boot before the engine starts', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        const runId = await queueRun(store, clock, 'greeter');

        const { harness, engine } = build({
            store,
            clock,
            dir: relative(process.cwd(), root.path),
        });
        await harness.setup();
        await engine().idle();

        expect(engine().agentRevision('greeter')).toBe(await hashAgentFolder(folder()));
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'completed', output: 'from folder' });
        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(await hashAgentFolder(folder()));
    });

    it('a folder change while stopped cancels the old runs at boot once', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v2') });
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'greeter',
            hash: 'h1',
            changedAt: START,
        });
        const old = await queueRun(store, clock, 'greeter');
        clock.advance(1_000);

        const first = build({ store, clock });
        await first.harness.setup();
        await first.engine().idle();
        expect((await store.runs.findOne(old))?.status).toBe('cancelled');
        await first.harness.stop();

        clock.advance(1_000);
        const later = await queueRun(store, clock, 'greeter');
        clock.advance(1_000);
        const second = build({ store, clock });
        await second.harness.setup();
        await second.engine().idle();

        expect(await store.runs.findOne(later)).toMatchObject({ status: 'completed', output: 'from folder' });
    });

    it('a normal boot cancels nothing', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'greeter',
            hash: await hashAgentFolder(folder()),
            changedAt: START,
        });
        const runId = await queueRun(store, clock, 'greeter');
        clock.advance(1_000);

        const { harness, engine } = build({ store, clock });
        await harness.setup();
        await engine().idle();

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
    });

    it('an upgrade from the full-folder hash moves the marker and cancels nothing', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1'), 'greeter/README.md': '# greeter' });
        // the hash before README* and editor leftovers were ignored: every file but dot-entries
        const legacy = createHash('sha256');
        for (const [key, content] of [['README.md', '# greeter'], ['agent.ts', agentFile('v1')]] as const) {
            legacy.update(`${key}\0`);
            legacy.update(content);
            legacy.update('\0');
        }
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'greeter',
            hash: legacy.digest('hex'),
            changedAt: START,
        });
        const runId = await queueRun(store, clock, 'greeter');
        clock.advance(1_000);

        const { harness, engine } = build({ store, clock });
        await harness.setup();
        await engine().idle();

        expect((await store.runs.findOne(runId))?.status).toBe('completed');
        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(await hashAgentFolder(folder()));
    });

    it('a code agent wins a name clash and the folder is an issue', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const code = codeAgent('greeter');
        const {
            harness,
            engine,
            issues,
            logger,
        } = build({ agents: [code] });
        await harness.setup();

        expect(engine().getAgent('greeter')).toBe(code);
        expect(engine().agentRevision('greeter')).toBeUndefined();
        expect(issues()).toEqual([{
            agent: 'greeter',
            message: 'greeter: a code agent has this name; the folder is not loaded.',
            at: START,
        }]);
        expect(logger.entries).toContainEqual(expect.objectContaining({
            level: 'warn',
            msg: 'agent load failed',
            agent: 'greeter',
            message: 'greeter: a code agent has this name; the folder is not loaded.',
        }));
    });

    it('an unknown model string is an issue, not a boot failure', async () => {
        await writeTree(root.path, {
            'greeter/agent.ts': agentFile('v1', 'acme/model'),
            'other/agent.ts': agentFile('v1', 'test/model', 'other'),
        });
        const {
            harness, 
            engine, 
            issues, 
        } = build();
        await harness.setup();

        expect(engine().getAgent('greeter')).toBeUndefined();
        expect(engine().getAgent('other')).toBeDefined();
        expect(issues()).toHaveLength(1);
        expect(issues()[0]).toMatchObject({ agent: 'greeter' });
        expect(issues()[0]?.message).toContain('"acme"');
    });

    it('a broken folder is an issue at boot without its absolute path', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': 'export default {\n' });
        const { harness, issues } = build();
        await harness.setup();

        expect(issues()).toHaveLength(1);
        expect(issues()[0]?.message).toMatch(/^greeter\/agent\.ts: /);
        expect(issues()[0]?.message).not.toContain(root.path);
    });

    it('a marker without a folder removes the agent\'s runs at boot', async () => {
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'gone',
            hash: 'h1',
            changedAt: START,
        });
        const runId = await queueRun(store, clock, 'gone');
        // any entry makes an empty listing authoritative (no unmounted volume)
        await writeFile(join(root.path, '.keep'), '');

        const { harness } = build({ store, clock });
        await harness.setup();

        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        expect(await store.agentRevisions.findOne('gone')).toBeUndefined();
    });

    it('an empty agents dir (an unmounted volume) removes no marker at boot', async () => {
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'gone',
            hash: 'h1',
            changedAt: START,
        });
        const runId = await queueRun(store, clock, 'gone');

        const { harness, logger } = build({ store, clock });
        await harness.setup();

        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect(await store.agentRevisions.findOne('gone')).toBeDefined();
        expect(logger.entries.filter((entry) => entry.msg === 'the agents dir is empty; no agent is removed')).toHaveLength(1);
    });

    it('a marker of a code agent is left alone at boot', async () => {
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        await store.agentRevisions.save({
            agent: 'triage',
            hash: 'h1',
            changedAt: START,
        });

        const { harness } = build({
            store,
            clock, 
            agents: [codeAgent('triage')], 
        });
        await harness.setup();

        expect(await store.agentRevisions.findOne('triage')).toBeDefined();
    });

    it('the watcher applies a change only once it is stable for one poll', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1', 'test/hang') });
        const {
            harness,
            engine,
            store,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const v1 = await hashAgentFolder(folder());
        const { runId } = await engine().dispatch({
            agent: 'greeter',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await expect.poll(async () => (await store.runs.findOne(runId))?.status).toBe('running');

        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v2') });
        const v2 = await hashAgentFolder(folder());
        await poll();
        expect(engine().agentRevision('greeter')).toBe(v1);
        expect((await store.runs.findOne(runId))?.status).toBe('running');

        await poll();
        await engine().idle();
        expect(engine().agentRevision('greeter')).toBe(v2);
        expect((await store.runs.findOne(runId))?.status).toBe('cancelled');
        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(v2);
    });

    it('logs agent reloaded once with the cancelled run ids', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1', 'test/hang') });
        const {
            harness,
            engine,
            store,
            logger,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const { runId } = await engine().dispatch({
            agent: 'greeter',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });
        await expect.poll(async () => (await store.runs.findOne(runId))?.status).toBe('running');

        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v2') });
        const v2 = await hashAgentFolder(folder());
        await poll();
        await poll();
        await engine().idle();

        const reloaded = logger.entries.filter((entry) => entry.msg === 'agent reloaded');
        expect(reloaded).toEqual([expect.objectContaining({
            level: 'info',
            agent: 'greeter',
            revision: v2.slice(0, 12),
            cancelled: [runId],
        })]);
        expect(await store.runs.findOne(runId)).toMatchObject({ status: 'cancelled', error: { code: 'agent_replaced' } });
    });

    it('logs agent removed', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1', 'test/hang'), '.keep': '' });
        const {
            harness,
            engine,
            logger,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        await rm(folder(), { recursive: true, force: true });
        await poll();
        await poll();
        await engine().idle();

        const removed = logger.entries.filter((entry) => entry.msg === 'agent removed');
        expect(removed).toEqual([expect.objectContaining({
            level: 'info',
            agent: 'greeter',
            cancelled: [],
        })]);
        expect(removed[0]).not.toHaveProperty('revision');
    });

    it('a normal boot logs no reload', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const { harness, logger } = build();
        await harness.setup();
        expect(logger.entries.filter((entry) => entry.msg === 'agent reloaded' || entry.msg === 'agent removed')).toEqual([]);
    });

    it('a new folder is loaded once it is stable for one poll', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();

        await writeTree(root.path, { 'newcomer/agent.ts': agentFile('v1', 'test/model', 'newcomer') });
        await poll();
        expect(engine().getAgent('newcomer')).toBeUndefined();
        await poll();
        expect(engine().agentRevision('newcomer')).toBe(await hashAgentFolder(folder('newcomer')));
    });

    it('a broken change keeps the old agent and records an issue; fixing it applies once', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            issues,
            logger,
            clock,
            store,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const v1 = await hashAgentFolder(folder());
        const changes: string[] = [];
        engine().on('agents.changed', (event) => {
            changes.push(`${event.kind}:${event.name}`);
        });

        await writeFile(join(folder(), 'agent.ts'), 'export default {\n');
        await poll();
        await poll();
        expect(engine().agentRevision('greeter')).toBe(v1);
        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(v1);
        expect(issues()).toEqual([{
            agent: 'greeter',
            message: expect.stringMatching(/^greeter\/agent\.ts: /),
            at: clock.now(),
        }]);
        await poll();
        expect(logger.entries.filter((entry) => entry.msg === 'agent load failed')).toHaveLength(1);

        await writeFile(join(folder(), 'agent.ts'), agentFile('v2'));
        await poll();
        await poll();
        await poll();
        expect(engine().agentRevision('greeter')).toBe(await hashAgentFolder(folder()));
        expect(issues()).toEqual([]);
        expect(changes).toEqual(['replaced:greeter']);
    });

    it('a removed folder removes the agent after two polls', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1'), '.keep': '' });
        const {
            harness,
            engine,
            store,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();

        await rm(folder(), { recursive: true, force: true });
        await poll();
        expect(engine().getAgent('greeter')).toBeDefined();

        await poll();
        expect(engine().getAgent('greeter')).toBeUndefined();
        expect(await store.agentRevisions.findOne('greeter')).toBeUndefined();
    });

    it('an agents dir left empty (an unmounted volume) keeps every agent and its runs', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            store,
            logger,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const { runId } = await engine().dispatch({
            agent: 'greeter',
            trigger: 'http',
            channel: 'http',
            payload: {},
        });

        await rm(folder(), { recursive: true, force: true });
        await poll();
        await poll();
        await poll();

        expect(engine().getAgent('greeter')).toBeDefined();
        expect(await store.agentRevisions.findOne('greeter')).toBeDefined();
        expect((await store.runs.findOne(runId))?.status).not.toBe('cancelled');
        expect(logger.entries.filter((entry) => entry.msg === 'the agents dir is empty; no agent is removed')).toHaveLength(1);
    });

    it('a folder back after one missing poll stays loaded', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const changes: string[] = [];
        engine().on('agents.changed', (event) => {
            changes.push(event.kind);
        });

        await rm(folder(), { recursive: true, force: true });
        await poll();
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        await poll();
        await poll();

        expect(engine().getAgent('greeter')).toBeDefined();
        expect(changes).toEqual([]);
    });

    it('stop waits for a reload in flight', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            clock,
            store,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();

        await writeFile(
            join(folder(), 'agent.ts'),
            `await new Promise((resolve) => setTimeout(resolve, 200));\n${agentFile('v2')}`,
        );
        const v2 = await hashAgentFolder(folder());
        await poll();
        clock.advance(POLL_MS);
        const current = engine();
        await harness.stop();

        expect(current.agentRevision('greeter')).toBe(v2);
        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(v2);
    });

    it('stop ends the polling', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness,
            engine,
            watch,
            poll,
        } = build();
        await harness.setup();
        await watch();
        const current = engine();
        await runHooks(harness.container, 'stopping');

        await writeTree(root.path, { 'newcomer/agent.ts': agentFile('v1', 'test/model', 'newcomer') });
        await poll();
        await poll();
        expect(current.getAgent('newcomer')).toBeUndefined();
    });

    it('job mode loads the folder and runs a folder agent\'s cron trigger', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1', 'test/model', 'greeter', [cronTrigger('0 9 * * *')]) });
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        const app = createApp({
            models: { test: provider() },
            modules: [configModule({ clock, logger: createRecordingLogger(clock) }), storeModule({ store })],
        });
        apps.push(app);

        const result = await app.runJob({
            env: {
                CHAMVI_AGENTS_DIR: root.path,
                CHAMVI_DRAIN_TIMEOUT_MS: '1000',
            },
            agent: 'greeter',
        });

        expect(result).toMatchObject({ status: 'completed', exitCode: 0 });
        expect((await store.runs.findOne(result.runId as string))?.output).toBe('from folder');
    });

    it('job mode starts no watcher', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const {
            harness, 
            engine, 
            poll, 
        } = build({ mode: 'job' });
        await harness.setup();
        await runHooks(harness.container, 'started');

        await writeTree(root.path, { 'newcomer/agent.ts': agentFile('v1', 'test/model', 'newcomer') });
        await poll();
        await poll();
        expect(engine().getAgent('greeter')).toBeDefined();
        expect(engine().getAgent('newcomer')).toBeUndefined();
    });

    it('GET /agents lists the folder agents and the load issues', async () => {
        await writeTree(root.path, {
            'greeter/agent.ts': agentFile('v1'),
            'broken/agent.ts': 'export default {\n',
        });
        const clock = new ControllableClock(START);
        const app = createApp({
            models: { test: provider() },
            modules: [configModule({ clock, logger: createRecordingLogger(clock) })],
        });
        apps.push(app);
        const port = await freePort();
        await app.start({
            env: {
                HOST: '127.0.0.1',
                PORT: String(port),
                CHAMVI_TOKENS: TOKENS,
                CHAMVI_AGENTS_DIR: root.path,
            },
        });

        const response = await fetch(`http://127.0.0.1:${port}/agents`, { headers: { authorization: `Bearer ${TOKEN}` } });
        const body = await response.json() as { data: Array<{ name: string }>; issues: Array<{ agent: string; message: string }> };

        expect(body.data.map((agent) => agent.name)).toEqual(['greeter']);
        expect(body.issues).toEqual([expect.objectContaining({ agent: 'broken', message: expect.stringMatching(/^broken\/agent\.ts: /) })]);
    });

    it('migrate mode ignores the folder', async () => {
        const { harness } = build({
            mode: 'migrate',
            dir: join(root.path, 'missing'),
            env: { DATABASE_URL: 'postgres://u:p@127.0.0.1:1/db' },
        });
        await harness.setup();

        expect(harness.container.has(AppToken.AGENT_ISSUES)).toBe(false);
    });

    it.each([
        ['missing', async () => join(root.path, 'missing')],
        ['a file', async () => {
            await writeTree(root.path, { 'file.txt': 'x' });
            return join(root.path, 'file.txt');
        }],
    ])('a dir that is %s is an InvalidAgentDefinitionError naming the variable only', async (_label, make) => {
        const dir = await make();
        const { harness } = build({ dir });

        const error = await rejectionOf(harness.setup());

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.message).toBe('CHAMVI_AGENTS_DIR must name a directory.');
    });

    it('without CHAMVI_AGENTS_DIR it does nothing for an app with code agents', async () => {
        const { harness, engine } = build({ agents: [codeAgent('triage')], env: { CHAMVI_AGENTS_DIR: '' } });
        await harness.setup();

        expect(engine().listAgents().map((agent) => agent.name)).toEqual(['triage']);
        expect(harness.container.has(AppToken.AGENT_ISSUES)).toBe(false);
    });

    it('without CHAMVI_AGENTS_DIR, ./agents and code agents it starts empty and warns', async () => {
        const cwd = await createTempDir();
        const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd.path);
        try {
            const {
                harness, 
                engine, 
                logger, 
            } = build({ env: { CHAMVI_AGENTS_DIR: '' } });
            await harness.setup();

            expect(engine().listAgents()).toEqual([]);
            expect(harness.container.has(AppToken.AGENT_ISSUES)).toBe(false);
            expect(logger.entries).toContainEqual(expect.objectContaining({ level: 'warn', msg: NO_AGENTS_MESSAGE }));
        } finally {
            spy.mockRestore();
            await cwd.remove();
        }
    });

    it('without CHAMVI_AGENTS_DIR it loads ./agents when that is a directory', async () => {
        const cwd = await createTempDir();
        await writeTree(cwd.path, { 'agents/greeter/agent.ts': agentFile('v1') });
        const spy = vi.spyOn(process, 'cwd').mockReturnValue(cwd.path);
        try {
            const { harness, engine } = build({ env: { CHAMVI_AGENTS_DIR: '' } });
            await harness.setup();

            expect(engine().listAgents().map((agent) => agent.name)).toEqual(['greeter']);
            expect(harness.container.has(AppToken.AGENT_ISSUES)).toBe(true);
        } finally {
            spy.mockRestore();
            await cwd.remove();
        }
    });
});

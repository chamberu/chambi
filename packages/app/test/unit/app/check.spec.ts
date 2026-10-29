/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createMemoryRepositories, defineAgent } from '@chamvi/core';
import type { Agent, Repositories, Run } from '@chamvi/core';
import { http } from '@chamvi/http';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    APP_ERROR_CODE,
    AppToken,
    configModule,
    createApp,
    repositoryModule,
} from '@chamvi/app';
import type { AppCheckResult, IApp, IModule } from '@chamvi/app';
import {
    agentFile,
    provider,
    queueRun,
} from '../../utils/agents-dir.ts';
import { TOKENS, rejectionOf } from '../../utils/app.ts';
import { createTempDir, writeTree } from '../../utils/folder.ts';
import { createRecordingLogger } from '../../utils/logger.ts';
import { textModel } from '../../utils/model.ts';
import { closeServer, freePort, listenOn } from '../../utils/port.ts';

const START = new Date('2026-10-26T00:00:00Z');

let apps: IApp[] = [];
let dir: { path: string; remove: () => Promise<void> };

beforeEach(async () => {
    dir = await createTempDir();
});

afterEach(async () => {
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    apps = [];
    await dir.remove();
});

/** A store that records every call that may write (any method not named find* or read*). */
function recordingRepository(store: ReturnType<typeof createMemoryRepositories>): { repositories: Repositories; writes: string[] } {
    const writes: string[] = [];
    const record = <T extends object>(target: T): T => new Proxy(target, {
        get(valueTarget, key, receiver) {
            const value: unknown = Reflect.get(valueTarget, key, receiver);
            if (typeof value !== 'function' || typeof key !== 'string') return value;
            return (...args: unknown[]) => {
                if (!/^(find|read)/.test(key)) writes.push(key);
                return (value as (...a: unknown[]) => unknown).apply(valueTarget, args);
            };
        },
    });
    return {
        repositories: {
            runs: record(store.runs),
            steps: record(store.steps),
            checkpoints: record(store.checkpoints),
            idempotency: record(store.idempotency),
            locks: record(store.locks),
            effects: record(store.effects),
            state: record(store.state),
            artifacts: record(store.artifacts),
            agentRevisions: record(store.agentRevisions),
            conversations: record(store.conversations),
        },
        writes,
    };
}

function build(options: {
    agents?: Agent[]; 
    repositories?: Repositories;
    clock?: ControllableClock;
    modules?: IModule[];
} = {}) {
    const clock = options.clock ?? new ControllableClock(START);
    const logger = createRecordingLogger(clock);
    const store = options.repositories ?? createMemoryRepositories({ clock });
    const app = createApp({
        agents: options.agents ?? [],
        models: { test: provider() },
        modules: [configModule({ clock, logger }), repositoryModule({ repositories: store }), ...options.modules ?? []],
    });
    apps.push(app);
    return {
        app,
        clock,
        logger,
        repositories: store,
    };
}

async function envFor(extra: Record<string, string> = {}) {
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

const triage = defineAgent({
    name: 'triage',
    model: textModel(),
    instructions: 'x',
    channels: [http.on()],
});

/** A run of `agent` parked on an approval. */
async function parkWaiting(store: Repositories, clock: ControllableClock, id: string, agent: string): Promise<void> {
    const now = clock.now();
    const run: Run = {
        id,
        agent,
        status: 'waiting',
        trigger: {
            id: `t-${id}`,
            agent,
            trigger: 'http',
            channel: 'http',
            payload: {},
            receivedAt: now,
        },
        waiting: {
            kind: 'approval',
            approvalId: 'a1',
            toolName: 'tool',
            toolCallId: 'c1',
            title: 'Run tool?',
            expiresAt: new Date(now.getTime() + 60_000),
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
    };
    await store.runs.insert(run);
}

describe('App.check', () => {
    it('resolves no issues for a clean app and starts nothing', async () => {
        const clock = new ControllableClock(START);
        const store = createMemoryRepositories({ clock });
        const runId = await queueRun(store, clock, 'triage');
        const { app } = build({
            agents: [triage],
            repositories: store,
            clock,
        });
        const { port, env } = await envFor();

        await expect(app.check({ env })).resolves.toEqual({ issues: [] } satisfies AppCheckResult);

        const server = await listenOn(port);
        await closeServer(server);
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
    });

    it('writes nothing to the store', async () => {
        const clock = new ControllableClock(START);
        const memory = createMemoryRepositories({ clock });
        await writeTree(dir.path, { 'triage/agent.ts': agentFile('v2', 'test/model', 'triage') });
        const stale = {
            agent: 'triage', 
            hash: 'c'.repeat(64), 
            changedAt: START, 
        };
        const orphan = {
            agent: 'gone', 
            hash: 'd'.repeat(64), 
            changedAt: START, 
        };
        await memory.agentRevisions.save(stale);
        await memory.agentRevisions.save(orphan);
        const queued = await queueRun(memory, clock, 'triage');
        await parkWaiting(memory, clock, 'waiting-run', 'triage');
        const { repositories: store, writes } = recordingRepository(memory);
        const { app } = build({ repositories: store, clock });
        const { env } = await envFor({ CHAMVI_AGENTS_DIR: dir.path });

        await expect(app.check({ env })).resolves.toEqual({ issues: [] });

        expect(writes).toEqual([]);
        expect((await memory.runs.findOne(queued))?.status).toBe('queued');
        expect((await memory.runs.findOne('waiting-run'))?.status).toBe('waiting');
        expect(await memory.agentRevisions.findOne('triage')).toEqual(stale);
        expect(await memory.agentRevisions.findOne('gone')).toEqual(orphan);
    });

    it('reports a broken folder as an issue', async () => {
        await writeTree(dir.path, { 'triage/agent.ts': 'export default 42;\n' });
        const { app } = build();
        const { env } = await envFor({ CHAMVI_AGENTS_DIR: dir.path });

        const { issues } = await app.check({ env });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.message).toMatch(/^triage\/agent\.ts: /);
    });

    it('reports a folder subscribing to a channel no module contributes', async () => {
        await writeTree(dir.path, { 'triage/agent.ts': agentFile('v1', 'test/model', 'triage', ['{ channel: \'github\', id: \'github:issues\', options: {} }']) });
        const { app } = build();
        const { env } = await envFor({ CHAMVI_AGENTS_DIR: dir.path });

        const { issues } = await app.check({ env });
        expect(issues).toHaveLength(1);
        expect(issues[0]?.message).toContain('unknown channel "github".');
    });

    it('rejects a code agent on an unknown channel with invalid_agent_definition', async () => {
        const lonely = defineAgent({
            name: 'lonely',
            model: textModel(),
            instructions: 'x',
            channels: [{
                channel: 'github', 
                id: 'github:issues', 
                options: {}, 
            }],
        });
        const { app } = build({ agents: [lonely] });
        const { env } = await envFor();

        const error = await rejectionOf(app.check({ env }));
        expect(error.code).toBe('invalid_agent_definition');
    });

    it('rejects a code agent with a cron subscription croner refuses, as start does', async () => {
        const nightly = defineAgent({
            name: 'nightly',
            model: textModel(),
            instructions: 'x',
            channels: [{
                channel: 'cron',
                id: 'cron:0 0 * * 1/2',
                options: { expression: '0 0 * * 1/2', overlap: 'skip' },
            }],
        });
        const { app } = build({ agents: [nightly] });
        const { env } = await envFor();

        const error = await rejectionOf(app.check({ env }));
        expect(error.code).toBe('invalid_agent_definition');
        expect(error.message).toContain('0 0 * * 1/2');
    });

    it('rejects without CHAMVI_TOKENS outside dev', async () => {
        const { app } = build({ agents: [triage] });
        const { env } = await envFor();
        delete (env as Record<string, string | undefined>).CHAMVI_TOKENS;

        const error = await rejectionOf(app.check({ env }));
        expect(error.code).toBe('invalid_agent_definition');
        expect(error.message).toContain('No authenticator');
    });

    it('rejects a missing provider key', async () => {
        const keyless = defineAgent({
            name: 'keyless',
            model: 'anthropic/claude-x',
            instructions: 'x',
            channels: [http.on()],
        });
        const { app } = build({ agents: [keyless] });
        const { env } = await envFor();

        const error = await rejectionOf(app.check({ env }));
        expect(error.code).toBe('invalid_agent_definition');
    });

    it('runs the paired engineCreated and drained hooks, never started or stopping', async () => {
        const phases: string[] = [];
        const hooks: IModule = {
            name: 'hooks',
            setup: async (container) => {
                container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                    useValue: {
                        name: 'probe',
                        engineCreated: () => { phases.push('engineCreated'); },
                        started: () => { phases.push('started'); },
                        stopping: () => { phases.push('stopping'); },
                        drained: () => { phases.push('drained'); },
                    },
                });
            },
        };
        const { app } = build({ agents: [triage], modules: [hooks] });
        const { env } = await envFor();

        await app.check({ env });
        expect(phases).toEqual(['engineCreated', 'drained']);
    });

    it('does not wait the readiness delay', async () => {
        const { app } = build({ agents: [triage] });
        const { env } = await envFor({ CHAMVI_READINESS_DELAY_MS: '60000' });

        const started = Date.now();
        await app.check({ env });
        expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('is the app\'s one lifecycle', async () => {
        const { app } = build({ agents: [triage] });
        const { env } = await envFor();

        await app.check({ env });
        const error = await rejectionOf(app.start({ env }));
        expect(error.code).toBe(APP_ERROR_CODE.IN_USE);
    });
});

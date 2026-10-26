/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryStore, defineAgent } from '@chamvi/core';
import type { Agent, IStore, Run } from '@chamvi/core';
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
    configModule,
    createApp,
    storeModule,
} from '@chamvi/app';
import type { AppCheckResult, IApp } from '@chamvi/app';
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

/** A store that records every call that may write (any method not named get*, list* or read*). */
function recordingStore(store: MemoryStore): { store: IStore; writes: string[] } {
    const writes: string[] = [];
    const proxy = new Proxy(store, {
        get(target, key, receiver) {
            const value: unknown = Reflect.get(target, key, receiver);
            if (typeof value !== 'function' || typeof key !== 'string') return value;
            return (...args: unknown[]) => {
                if (!/^(get|list|read)/.test(key)) writes.push(key);
                return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
        },
    });
    return { store: proxy, writes };
}

function build(options: {
    agents?: Agent[]; 
    store?: IStore; 
    clock?: ControllableClock 
} = {}) {
    const clock = options.clock ?? new ControllableClock(START);
    const logger = createRecordingLogger(clock);
    const store = options.store ?? new MemoryStore({ clock });
    const app = createApp({
        agents: options.agents ?? [],
        models: { test: provider() },
        modules: [configModule({ clock, logger }), storeModule({ store })],
    });
    apps.push(app);
    return {
        app,
        clock,
        logger,
        store,
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
async function parkWaiting(store: IStore, clock: ControllableClock, id: string, agent: string): Promise<void> {
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
    await store.createRun(run);
}

describe('App.check', () => {
    it('resolves no issues for a clean app and starts nothing', async () => {
        const clock = new ControllableClock(START);
        const store = new MemoryStore({ clock });
        const runId = await queueRun(store, clock, 'triage');
        const { app } = build({
            agents: [triage],
            store,
            clock,
        });
        const { port, env } = await envFor();

        await expect(app.check({ env })).resolves.toEqual({ issues: [] } satisfies AppCheckResult);

        const server = await listenOn(port);
        await closeServer(server);
        expect((await store.getRun(runId))?.status).toBe('queued');
    });

    it('writes nothing to the store', async () => {
        const clock = new ControllableClock(START);
        const memory = new MemoryStore({ clock });
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
        await memory.setAgentRevision(stale);
        await memory.setAgentRevision(orphan);
        const queued = await queueRun(memory, clock, 'triage');
        await parkWaiting(memory, clock, 'waiting-run', 'triage');
        const { store, writes } = recordingStore(memory);
        const { app } = build({ store, clock });
        const { env } = await envFor({ CHAMVI_AGENTS_DIR: dir.path });

        await expect(app.check({ env })).resolves.toEqual({ issues: [] });

        expect(writes).toEqual([]);
        expect((await memory.getRun(queued))?.status).toBe('queued');
        expect((await memory.getRun('waiting-run'))?.status).toBe('waiting');
        expect(await memory.getAgentRevision('triage')).toEqual(stale);
        expect(await memory.getAgentRevision('gone')).toEqual(orphan);
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

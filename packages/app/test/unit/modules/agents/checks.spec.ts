/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createMemoryStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { configModule, createApp, schedulerModule } from '@chamvi/app';
import type { IApp } from '@chamvi/app';
import { TOKEN, TOKENS } from '../../../utils/app.ts';
import {
    HTTP_TRIGGER,
    START,
    agentFile,
    buildAgentsDirHarness,
    cronTrigger,
    provider,
    queueRun,
} from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import type { Harness } from '../../../utils/harness.ts';
import { createRecordingLogger } from '../../../utils/logger.ts';
import { freePort } from '../../../utils/port.ts';

let root: { path: string; remove: () => Promise<void> };
let apps: IApp[] = [];
let harnesses: Harness[] = [];

beforeEach(async () => {
    root = await createTempDir();
});

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    await Promise.all(apps.map((app) => app.stop().catch(() => {})));
    apps = [];
    harnesses = [];
    await root.remove();
});

const LONG_NAME = 'a'.repeat(62);

describe('the checks a folder agent passes before it is registered', () => {
    it.each([
        ['an unknown channel', { 'broken/agent.ts': 'export default { name: \'broken\', definition: { model: \'test/model\', instructions: \'x\', channels: [{ channel: \'slack\', id: \'slack\', options: {} }] } };\n' }, 'broken', /unknown channel "slack"/],
        ['a cron timezone hubwire refuses', { 'broken/agent.ts': agentFile('x', 'test/model', 'broken', [cronTrigger('0 9 * * *', 'Mars/Base')]) }, 'broken', /Invalid timezone/],
        ['a cron expression croner refuses', { 'broken/agent.ts': agentFile('x', 'test/model', 'broken', [cronTrigger('0 0 * * 1/2')]) }, 'broken', /0 0 \* \* 1\/2/],
        ['a model on an unconfigured provider', { 'broken/agent.ts': agentFile('x', 'nope/m', 'broken') }, 'broken', /Agent "broken" uses provider "nope", which is not configured/],
        ['a name whose run_<agent> MCP tool is too long', { [`${LONG_NAME}/agent.ts`]: agentFile('x', 'test/model', LONG_NAME, [HTTP_TRIGGER]) }, LONG_NAME, /exceeds 64 characters/],
    ])('%s is a load issue at boot, never a failed start', async (_label, tree, agent, message) => {
        await writeTree(root.path, { ...tree, 'greeter/agent.ts': agentFile('v1') });
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
        expect(body.data.map((entry) => entry.name)).toEqual(['greeter']);
        expect(body.issues).toEqual([expect.objectContaining({ agent, message: expect.stringMatching(message) })]);
    });

    it.each([
        ['an unknown channel', { 'agent.ts': 'export default { name: \'greeter\', definition: { model: \'test/model\', instructions: \'v2\', channels: [{ channel: \'slack\', id: \'slack\', options: {} }] } };\n' }],
        ['a cron subscription hubwire refuses', { 'agent.ts': agentFile('v2', 'test/model', 'greeter', [cronTrigger('0 0 * * 1/2')]) }],
        ['a model on an unconfigured provider', { 'agent.ts': agentFile('v2', 'nope/m') }],
    ])('a change to %s keeps the old agent, cancels nothing and is tried once', async (_label, change) => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
            modules: [schedulerModule()],
        });
        harnesses.push(setup.harness);
        await setup.harness.setup();
        await setup.watch();
        const marker = await store.agentRevisions.findOne('greeter');
        const runId = await queueRun(store, clock, 'greeter');

        await writeTree(join(root.path, 'greeter'), change);
        for (let i = 0; i < 5; i++) await setup.poll();

        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v1');
        expect(await store.agentRevisions.findOne('greeter')).toEqual(marker);
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect(setup.issues()).toEqual([expect.objectContaining({ agent: 'greeter' })]);
        expect(setup.logger.entries.filter((entry) => entry.msg === 'agent load failed')).toHaveLength(1);
        expect(setup.logger.entries.filter((entry) => entry.msg === 'agent reload failed')).toHaveLength(0);

        // fixed: applied once
        await writeFile(join(root.path, 'greeter', 'agent.ts'), agentFile('v3', 'test/model', 'greeter', [cronTrigger('0 9 * * *')]));
        await setup.poll();
        await setup.poll();
        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v3');
        expect(setup.issues()).toEqual([]);
    });
});

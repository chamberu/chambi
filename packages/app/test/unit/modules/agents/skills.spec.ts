/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { agentFile, buildAgentsDirHarness, queueRun } from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import type { Harness } from '../../../utils/harness.ts';

let root: Awaited<ReturnType<typeof createTempDir>>;
const harnesses: Harness[] = [];
beforeEach(async () => {
    root = await createTempDir();
});
afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses.length = 0;
    await root.remove();
});

function sourceAgent(instructions = 'v1', channel = '') {
    return `export default { name: 'greeter', definition: { model: 'test/model', instructions: '${instructions}',
        ${channel}
        skills: [{ skills: [{ name: 'review', version: '1', hash: '${'a'.repeat(64)}' }],
            async load() { return []; } }],
    } };`;
}

function build(check = false) {
    const setup = buildAgentsDirHarness({ root: root.path, check });
    harnesses.push(setup.harness);
    return setup;
}


function controlledSourceAgent(instructions = 'v2', failure = 'mismatch') {
    const path = JSON.stringify(join(root.path, 'provider.json'));
    return `import { readFile, writeFile } from 'node:fs/promises';
        export default { name: 'greeter', definition: { model: 'test/model', instructions: '${instructions}',
            skills: [{ skills: [{ name: 'review', version: '1', hash: '${'a'.repeat(64)}' }],
                async load() {
                    const state = JSON.parse(await readFile(${path}, 'utf8'));
                    state.attempts++;
                    await writeFile(${path}, JSON.stringify(state));
                    if (!state.ready) {
                        if ('${failure}' === 'transient') throw new Error('source temporarily unavailable');
                        return [];
                    }
                    return [{ name: 'review', version: '1', hash: '${'a'.repeat(64)}',
                        description: 'Review', ignoredFields: [], body: 'Reviewed body', references: {} }];
                } }],
        } };`;
}

async function providerState(): Promise<{ attempts: number; ready: boolean }> {
    return JSON.parse(await readFile(join(root.path, 'provider.json'), 'utf8'));
}

async function startControlledReload(failure = 'mismatch') {
    await writeTree(root.path, {
        'greeter/agent.ts': agentFile('v1'),
        'keeper/agent.ts': agentFile('keeper', 'test/model', 'keeper'),
        'provider.json': JSON.stringify({ attempts: 0, ready: false }),
    });
    const setup = build();
    await setup.harness.setup();
    await setup.watch();
    await writeTree(join(root.path, 'greeter'), { 'agent.ts': controlledSourceAgent('v2', failure) });
    await setup.poll();
    await setup.poll();
    return setup;
}

async function pollTimes(setup: ReturnType<typeof build>, count: number) {
    for (let i = 0; i < count; i++) {
        await setup.poll();
    }
}

describe('folder skill verification', () => {
    it('aborts boot on required verification failure before a revision or registration', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent() });
        const setup = build();
        await expect(setup.harness.setup()).rejects.toThrow(/skill/i);
        expect(setup.engine().getAgent('greeter')).toBeUndefined();
        expect(await setup.store.getAgentRevision('greeter')).toBeUndefined();
    });

    it('keeps static definition failures tolerant and never loads their source', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent('v1', "channels: [{ channel: 'unknown', id: 'unknown', options: {} }],") });
        const setup = build();
        await setup.harness.setup();
        expect(setup.issues()[0]?.message).toContain('unknown channel');
        expect(setup.engine().getAgent('greeter')).toBeUndefined();
    });

    it('check validates folder headers without loading the source or writing revisions', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent() });
        const setup = build(true);
        await setup.harness.setup();
        expect(setup.issues()).toEqual([]);
        expect(await setup.store.getAgentRevision('greeter')).toBeUndefined();
    });

    it('hot reload retains the old agent, marker and queued run when verification fails', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const setup = build();
        await setup.harness.setup();
        await setup.watch();
        const previous = setup.engine().getAgent('greeter');
        const marker = await setup.store.getAgentRevision('greeter');
        const runId = await queueRun(setup.store, setup.clock, 'greeter');
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': sourceAgent('v2') });
        await setup.poll();
        await setup.poll();
        expect(setup.engine().getAgent('greeter')).toBe(previous);
        expect(await setup.store.getAgentRevision('greeter')).toEqual(marker);
        expect((await setup.store.getRun(runId))?.status).toBe('queued');
        expect(setup.issues()).toMatchObject([{ agent: 'greeter', message: expect.stringMatching(/skill/i) }]);
    });

    it.each(['mismatch', 'transient'])('backs off %s preparation failures and recovers without a folder edit', async (failure) => {
        const setup = await startControlledReload(failure);
        expect((await providerState()).attempts).toBe(1);
        expect(setup.issues()).toHaveLength(1);
        let attempts = 1;
        for (const delay of [2, 4, 8, 16, 32, 60, 60]) {
            await pollTimes(setup, delay - 1);
            expect((await providerState()).attempts).toBe(attempts);
            await setup.poll();
            expect((await providerState()).attempts).toBe(++attempts);
        }
        const state = await providerState();
        await writeFile(join(root.path, 'provider.json'), JSON.stringify({ ...state, ready: true }));
        await pollTimes(setup, 59);
        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v1');
        await setup.poll();
        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v2');
        expect(setup.issues()).toEqual([]);
        await pollTimes(setup, 61);
        expect((await providerState()).attempts).toBe(attempts + 1);
    });

    it('resets backoff when changed content becomes stable', async () => {
        const setup = await startControlledReload();
        await pollTimes(setup, 2);
        expect((await providerState()).attempts).toBe(2);
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': controlledSourceAgent('v3') });
        await setup.poll();
        expect((await providerState()).attempts).toBe(2);
        await setup.poll();
        expect((await providerState()).attempts).toBe(3);
        await setup.poll();
        expect((await providerState()).attempts).toBe(3);
        await setup.poll();
        expect((await providerState()).attempts).toBe(4);
    });

    it('resumes retries when an unstable edit returns to the failing content', async () => {
        const setup = await startControlledReload();
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': controlledSourceAgent('unstable') });
        await setup.poll();
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': controlledSourceAgent() });
        await setup.poll();
        expect((await providerState()).attempts).toBe(1);
        await setup.poll();
        expect((await providerState()).attempts).toBe(2);
        await setup.poll();
        expect((await providerState()).attempts).toBe(2);
        await setup.poll();
        expect((await providerState()).attempts).toBe(3);
    });

    it.each(['revert', 'remove'])('clears preparation issues and backoff after %s', async (change) => {
        const setup = await startControlledReload();
        await pollTimes(setup, 2);
        expect((await providerState()).attempts).toBe(2);
        if (change === 'revert') {
            await writeTree(join(root.path, 'greeter'), { 'agent.ts': agentFile('v1') });
        } else {
            await rm(join(root.path, 'greeter'), { recursive: true });
        }
        await pollTimes(setup, 2);
        expect(setup.issues()).toEqual([]);
        if (change === 'remove') {
            expect(setup.engine().getAgent('greeter')).toBeUndefined();
        }
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': controlledSourceAgent() });
        await pollTimes(setup, 2);
        expect((await providerState()).attempts).toBe(3);
        await setup.poll();
        expect((await providerState()).attempts).toBe(3);
        await setup.poll();
        expect((await providerState()).attempts).toBe(4);
        await setup.harness.stop();
        await pollTimes(setup, 61);
        expect((await providerState()).attempts).toBe(4);
    });
});

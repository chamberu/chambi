/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Engine, MemoryStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import {
    START,
    agentFile,
    buildAgentsDirHarness,
    queueRun,
} from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import type { Harness } from '../../../utils/harness.ts';

let root: { path: string; remove: () => Promise<void> };
let harnesses: Harness[] = [];

beforeEach(async () => {
    root = await createTempDir();
});

afterEach(async () => {
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
    await root.remove();
});

function otherEngine(store: MemoryStore, clock: ControllableClock): Engine {
    return new Engine({
        store,
        clock,
        agents: [],
        onError: () => {},
    });
}

describe('revision markers moved by another process', () => {
    it.each([
        ['removed', async (engine: Engine) => {
            await engine.removeAgent('greeter');
        }, /removed this agent's revision marker/],
        ['moved', async (_engine: Engine, store: MemoryStore, clock: ControllableClock) => {
            await store.setAgentRevision({
                agent: 'greeter', 
                hash: 'h0', 
                changedAt: clock.now(), 
            });
        }, /registered other content for this agent/],
    ])('a marker %s elsewhere is an issue on the replica whose folder did not change, until it matches again', async (_label, act, message) => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const clock = new ControllableClock(START);
        const store = new MemoryStore({ clock });
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
        });
        harnesses.push(setup.harness);
        await setup.harness.setup();
        await setup.watch();
        const marker = await store.getAgentRevision('greeter');

        await act(otherEngine(store, clock), store, clock);
        await setup.poll();
        await setup.poll();

        expect(setup.issues()).toEqual([expect.objectContaining({ agent: 'greeter', message: expect.stringMatching(message) })]);
        expect(setup.logger.entries.filter((entry) => entry.msg === 'agent revision moved')).toHaveLength(1);
        // not re-synced: the marker stays where the other process put it
        expect((await store.getAgentRevision('greeter'))?.hash).not.toBe(marker?.hash);

        await store.setAgentRevision(marker!);
        await setup.poll();
        expect(setup.issues()).toEqual([]);
    });

    it('a job does not remove an agent whose folder it does not see', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const clock = new ControllableClock(START);
        const store = new MemoryStore({ clock });
        await store.setAgentRevision({
            agent: 'elsewhere', 
            hash: 'h1', 
            changedAt: clock.now(), 
        });
        const runId = await queueRun(store, clock, 'elsewhere');
        const setup = buildAgentsDirHarness({
            root: root.path,
            mode: 'job',
            clock,
            store,
        });
        harnesses.push(setup.harness);

        await setup.harness.setup();

        expect(await store.getAgentRevision('elsewhere')).toBeDefined();
        expect((await store.getRun(runId))?.status).toBe('queued');
        expect(setup.engine().getAgent('greeter')).toBeDefined();
    });
});

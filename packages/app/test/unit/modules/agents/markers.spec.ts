/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import { Engine, InvalidRunStateError, createMemoryStore } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { hashAgentFolder } from '@chamvi/app';
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

function otherEngine(store: ReturnType<typeof createMemoryStore>, clock: ControllableClock): Engine {
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
        ['moved', async (_engine: Engine, store: ReturnType<typeof createMemoryStore>, clock: ControllableClock) => {
            await store.agentRevisions.save({
                agent: 'greeter',
                hash: 'h0',
                changedAt: clock.now(),
            });
        }, /registered other content for this agent/],
    ])('a marker %s elsewhere is an issue on the replica whose folder did not change, until it matches again', async (_label, act, message) => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
        });

        harnesses.push(setup.harness);
        await setup.harness.setup();
        await setup.watch();

        const marker = await store.agentRevisions.findOne('greeter');

        await act(otherEngine(store, clock), store, clock);
        await setup.poll();
        await setup.poll();

        expect(setup.issues()).toEqual([expect.objectContaining({ agent: 'greeter', message: expect.stringMatching(message) })]);
        expect(setup.logger.entries.filter((entry) => entry.msg === 'agent revision moved')).toHaveLength(1);
        // not re-synced: the marker stays where the other process put it
        expect((await store.agentRevisions.findOne('greeter'))?.hash).not.toBe(marker?.hash);

        await store.agentRevisions.save(marker!);
        await setup.poll();
        expect(setup.issues()).toEqual([]);
    });

    it('a job does not remove an agent whose folder it does not see', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });

        await store.agentRevisions.save({
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

        expect(await store.agentRevisions.findOne('elsewhere')).toBeDefined();
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect(setup.engine().getAgent('greeter')).toBeDefined();
    });
});

describe('a job never reloads an agent', () => {
    const OLD = 'c'.repeat(64);

    it('a job writes the first marker and runs', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });
        const runId = await queueRun(store, clock, 'greeter');
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
            mode: 'job',
            job: { agent: 'greeter' },
        });

        harnesses.push(setup.harness);
        await setup.harness.setup();

        const hash = await hashAgentFolder(join(root.path, 'greeter'));

        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(hash);
        expect(setup.engine().agentRevision('greeter')).toBe(hash);
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect(setup.issues()).toEqual([]);
    });

    it('a job moves a different marker when the agent has no unsettled runs', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });

        await store.agentRevisions.save({
            agent: 'greeter',
            hash: OLD,
            changedAt: START,
        });

        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
            mode: 'job',
            job: { agent: 'greeter' },
        });

        harnesses.push(setup.harness);
        await setup.harness.setup();

        expect((await store.agentRevisions.findOne('greeter'))?.hash).toBe(await hashAgentFolder(join(root.path, 'greeter')));
        expect(setup.issues()).toEqual([]);
    });

    it('a job with a changed folder fails and cancels nothing', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });

        await store.agentRevisions.save({
            agent: 'greeter',
            hash: OLD,
            changedAt: START,
        });

        const runId = await queueRun(store, clock, 'greeter');
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
            mode: 'job',
            job: { agent: 'greeter' },
        });

        harnesses.push(setup.harness);

        const error = await setup.harness.setup().then(() => undefined, (e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidRunStateError);

        const hash = await hashAgentFolder(join(root.path, 'greeter'));

        expect((error as Error).message).toContain('greeter');
        expect((error as Error).message).toContain(OLD.slice(0, 12));
        expect((error as Error).message).toContain(hash.slice(0, 12));
        expect(await store.agentRevisions.findOne('greeter')).toEqual({
            agent: 'greeter',
            hash: OLD,
            changedAt: START,
        });
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
    });

    it('a conflict of another agent is an issue and the job still runs', async () => {
        await writeTree(root.path, {
            'greeter/agent.ts': agentFile('v1'),
            'triage/agent.ts': agentFile('v1', 'test/model', 'triage'),
        });

        const clock = new ControllableClock(START);
        const store = createMemoryStore({ clock });

        await store.agentRevisions.save({
            agent: 'triage',
            hash: OLD,
            changedAt: START,
        });

        const runId = await queueRun(store, clock, 'triage');
        const setup = buildAgentsDirHarness({
            root: root.path,
            clock,
            store,
            mode: 'job',
            job: { agent: 'greeter' },
        });

        harnesses.push(setup.harness);
        await setup.harness.setup();

        expect(setup.engine().getAgent('greeter')).toBeDefined();
        expect(setup.engine().getAgent('triage')).toBeUndefined();
        expect(setup.issues()).toHaveLength(1);
        expect(setup.issues()[0]?.agent).toBe('triage');
        expect(setup.issues()[0]?.message).toContain('A job never reloads an agent: start the app to apply the change.');
        expect((await store.runs.findOne(runId))?.status).toBe('queued');
        expect((await store.agentRevisions.findOne('triage'))?.hash).toBe(OLD);
    });
});

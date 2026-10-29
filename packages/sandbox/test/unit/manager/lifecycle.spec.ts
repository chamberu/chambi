/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { 
    afterEach, 
    describe, 
    expect, 
    it, 
} from 'vitest';
import {
    Engine,
    RunStatus,
    SandboxError,
    approve,
    createMemoryRepositories,
    defineAgent,
} from '@chamvi/core';
import type { AgentHooks, Run, RunEvent } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { mockModel } from '../../utils/model.ts';
import type { MockResponse } from '../../utils/model.ts';
import { createFakeProvider } from '../../utils/provider.ts';
import type { FakeProvider } from '../../utils/provider.ts';

const engines: Engine[] = [];

afterEach(() => {
    for (const engine of engines) engine.stop();
    engines.length = 0;
});

const text = (t: string): MockResponse => ({ parts: [{ type: 'text', text: t }] });
const call = (toolName: string, input: unknown = {}): MockResponse => ({
    parts: [{
        type: 'tool-call',
        toolName,
        input,
    }],
});

type Setup = {
    script: MockResponse[];
    /** A tool whose calls wait for an approval (asked in a beforeToolExecution hook). */
    gate?: string;
    provider?: FakeProvider;
};

function gateHooks(gate: string | undefined): AgentHooks | undefined {
    if (!gate) return undefined;
    return {
        async beforeToolExecution({ toolName, input }, ctx) {
            if (toolName === gate) await approve(ctx, { title: `Run ${toolName}?` });
            return input;
        },
    };
}

async function run(s: Setup) {
    const clock = new ControllableClock(new Date(1_000_000));
    const store = createMemoryRepositories({ clock });
    const provider = s.provider ?? createFakeProvider({ clock });
    const errors: unknown[] = [];
    const manager = createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
        onError: (error) => { errors.push(error); },
    });
    const agent = defineAgent({
        name: 'coder',
        instructions: 'You code.',
        model: mockModel(s.script),
        tools: manager.tools(),
        hooks: gateHooks(s.gate),
    });
    const engine = new Engine({
        repositories: store,
        agents: [agent],
        clock,
        onError: () => {},
    });
    engines.push(engine);
    manager.attach(engine);
    await engine.start();
    const { runId } = await engine.dispatch({
        agent: 'coder',
        trigger: 'http',
        channel: 'http',
        payload: {},
    });
    await engine.idle();
    return {
        provider,
        manager,
        errors,
        runId,
        run: await store.runs.findOne(runId),
    };
}

/** An engine stand-in that records its run.updated listeners. */
function fakeEngine() {
    const listeners = new Set<(e: Extract<RunEvent, { type: 'run.updated' }>) => void>();
    return {
        listeners,
        on: ((type: string, listener: (e: Extract<RunEvent, { type: 'run.updated' }>) => void) => {
            if (type === 'run.updated') listeners.add(listener);
            return () => { listeners.delete(listener); };
        }) as Engine['on'],
        emit(run: Pick<Run, 'id' | 'status'>) {
            for (const listener of listeners) listener({ type: 'run.updated', run: run as Run });
        },
    };
}

/** Lets already-queued callbacks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** Flushes until `condition` holds (a lookup and a create each take a tick); at most 20 rounds. */
async function until(condition: () => boolean): Promise<void> {
    for (let round = 0; round < 20 && !condition(); round++) await flush();
    expect(condition()).toBe(true);
}

describe('workspace manager: run lifecycle', () => {
    it('disposes when the run completes', async () => {
        const { provider, run: done } = await run({ script: [call('create_workspace'), text('done')] });
        expect(done?.status).toBe('completed');
        expect(provider.created).toHaveLength(1);
        const [id] = provider.workspaces.keys();
        expect(provider.disposed).toEqual([id]);
    });

    it('disposes when the run fails', async () => {
        // turn 2 has no script: the mock model throws
        const { provider, run: failed } = await run({ script: [call('create_workspace')] });
        expect(failed?.status).toBe('failed');
        const [id] = provider.workspaces.keys();
        expect(provider.disposed).toEqual([id]);
    });

    it('keeps the workspace while the run waits', async () => {
        const {
            provider,
            manager,
            runId,
            run: waiting,
        } = await run({
            script: [call('create_workspace'), call('dispose_workspace')],
            gate: 'dispose_workspace',
        });
        expect(waiting?.status).toBe('waiting');
        expect(provider.disposed).toEqual([]);
        const [id] = provider.workspaces.keys();
        expect((await manager.get(runId)).id).toBe(id);
    });

    it('reports dispose failures', async () => {
        const provider = createFakeProvider();
        const create = provider.create.bind(provider);
        const failure = new Error('container gone');
        provider.create = async (options) => {
            const workspace = await create(options);
            workspace.dispose = async () => { throw failure; };
            return workspace;
        };
        const {
            manager,
            errors,
            runId,
        } = await run({ script: [call('create_workspace'), text('done')], provider });
        await flush();
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SandboxError);
        expect((errors[0] as SandboxError).cause).toBe(failure);
        // the workspace still exists, so a lookup finds it again
        expect((await manager.get(runId)).disposed).toBe(false);
    });

    it('disposes only on completed, failed and cancelled', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createFakeProvider({ clock });
        const manager = createWorkspaceManager({
            provider, 
            clock, 
            gcIntervalMs: 0, 
        });
        const engine = fakeEngine();
        manager.attach(engine);
        for (const status of [RunStatus.QUEUED, RunStatus.RUNNING, RunStatus.WAITING, RunStatus.INTERRUPTED]) {
            await manager.acquire('r1', {});
            engine.emit({ id: 'r1', status });
            await flush();
            expect(provider.disposed).toEqual([]);
        }
        for (const [index, status] of [RunStatus.COMPLETED, RunStatus.FAILED, RunStatus.CANCELLED].entries()) {
            await manager.acquire(`r${index + 2}`, {});
            engine.emit({ id: `r${index + 2}`, status });
            await flush();
            expect(provider.disposed).toHaveLength(index + 1);
        }
    });

    it('close() keeps the workspaces of live runs and unsubscribes', async () => {
        const {
            provider,
            manager,
            runId,
        } = await run({
            script: [call('create_workspace'), call('dispose_workspace')],
            gate: 'dispose_workspace',
        });
        const engine = fakeEngine();
        const unsubscribe = manager.attach(engine);
        expect(engine.listeners.size).toBe(1);
        await manager.close();
        expect(provider.disposed).toEqual([]);
        expect(engine.listeners.size).toBe(0);
        await expect(manager.get(runId)).rejects.toThrow(/closed/);
        engine.emit({ id: runId, status: RunStatus.COMPLETED });
        await flush();
        expect(provider.disposed).toEqual([]);
        unsubscribe();
        await expect(manager.close()).resolves.toBeUndefined();
    });

    it('close({ dispose: true }) disposes the workspaces of live runs too', async () => {
        const {
            provider,
            manager,
            errors,
        } = await run({
            script: [call('create_workspace'), call('dispose_workspace')],
            gate: 'dispose_workspace',
        });
        expect(provider.disposed).toEqual([]);
        await manager.close({ dispose: true });
        expect(provider.disposed).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    it('close() waits for disposals the settled runs started', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createFakeProvider({ clock });
        const errors: unknown[] = [];
        const manager = createWorkspaceManager({
            provider,
            clock,
            gcIntervalMs: 0,
            onError: (error) => { errors.push(error); },
        });
        const engine = fakeEngine();
        manager.attach(engine);

        const gate = Promise.withResolvers<void>();
        const gated = async (runId: string) => {
            const { workspace } = await manager.acquire(runId, {});
            const dispose = workspace.dispose.bind(workspace);
            workspace.dispose = async () => {
                await gate.promise;
                await dispose();
            };
            return workspace;
        };
        // one released when its run settled, one dropped when found expired
        await gated('r1');
        const expiring = await gated('r2');
        engine.emit({ id: 'r1', status: RunStatus.COMPLETED });
        Object.assign(expiring.info, { expiresAt: new Date(clock.now().getTime()) });
        await expect(manager.get('r2')).rejects.toThrow(/expired/);

        let closed = false;
        const closing = manager.close().then(() => { closed = true; });
        await flush();
        expect(closed).toBe(false);

        gate.resolve();
        await closing;
        expect(provider.disposed).toHaveLength(2);
        expect(errors).toEqual([]);
    });

    it('close() waits for a create in flight whose run settled', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createFakeProvider({ clock });
        const errors: unknown[] = [];
        const manager = createWorkspaceManager({
            provider,
            clock,
            gcIntervalMs: 0,
            onError: (error) => { errors.push(error); },
        });
        const engine = fakeEngine();
        manager.attach(engine);

        // the fake provider ignores the abort while gated, like a cleanup in flight
        const gate = Promise.withResolvers<void>();
        provider.gate = gate.promise;
        const acquiring = manager.acquire('r1', {}).catch((error: unknown) => error);
        await until(() => provider.created.length === 1);
        engine.emit({ id: 'r1', status: RunStatus.CANCELLED });

        let closed = false;
        const closing = manager.close().then(() => { closed = true; });
        await flush();
        expect(closed).toBe(false);

        gate.resolve();
        await closing;
        expect(await acquiring).toBeInstanceOf(SandboxError);
        const [id] = provider.workspaces.keys();
        expect(provider.disposed).toEqual([id]);
        expect(errors).toEqual([]);
    });

    it('close() gives up on a create in flight of a settled run after timeoutMs', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createFakeProvider({ clock });
        const errors: unknown[] = [];
        const manager = createWorkspaceManager({
            provider,
            clock,
            gcIntervalMs: 0,
            onError: (error) => { errors.push(error); },
        });
        const engine = fakeEngine();
        manager.attach(engine);

        provider.gate = new Promise<void>(() => {});
        void manager.acquire('r1', {}).catch(() => undefined);
        await until(() => provider.created.length === 1);
        engine.emit({ id: 'r1', status: RunStatus.COMPLETED });

        let closed = false;
        const closing = manager.close({ timeoutMs: 1000 }).then(() => { closed = true; });
        await flush();
        clock.advance(999);
        await flush();
        expect(closed).toBe(false);
        clock.advance(1);
        await closing;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SandboxError);
        expect((errors[0] as Error).message).toMatch(/a workspace of run r1 still being created/);
    });

    it('close() reports a create in flight after another create of the same run finished', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createFakeProvider({ clock });
        const errors: unknown[] = [];
        const manager = createWorkspaceManager({
            provider,
            clock,
            gcIntervalMs: 0,
            onError: (error) => { errors.push(error); },
        });
        const engine = fakeEngine();
        manager.attach(engine);

        // two creates of one run, each behind its own gate
        const first = Promise.withResolvers<void>();
        provider.gate = first.promise;
        void manager.acquire('r1', {}).catch(() => undefined);
        await until(() => provider.created.length === 1);
        provider.gate = new Promise<void>(() => {});
        void manager.acquire('r1', { repo: 'octo/demo' }).catch(() => undefined);
        await until(() => provider.created.length === 2);
        engine.emit({ id: 'r1', status: RunStatus.COMPLETED });

        let closed = false;
        const closing = manager.close({ timeoutMs: 1000 }).then(() => { closed = true; });
        await flush();
        // the first create opens; the second is still running
        first.resolve();
        await flush();
        await flush();
        expect(provider.disposed).toHaveLength(1);
        expect(closed).toBe(false);

        clock.advance(1000);
        await closing;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SandboxError);
        expect((errors[0] as Error).message).toMatch(/still disposing: a workspace of run r1 still being created$/);
    });

    it('subscribes nothing when attached after close()', async () => {
        const { manager } = await run({ script: [text('done')] });
        await manager.close();
        const engine = fakeEngine();
        const unsubscribe = manager.attach(engine);
        expect(engine.listeners.size).toBe(0);
        unsubscribe();
    });

    it('unsubscribes one attach', async () => {
        const { manager } = await run({ script: [text('done')] });
        const engine = fakeEngine();
        const unsubscribe = manager.attach(engine);
        unsubscribe();
        expect(engine.listeners.size).toBe(0);
    });

    it('lets a workspace tool fail as a tool error, not the run', async () => {
        const { provider, run: done } = await run({ script: [call('dispose_workspace'), text('done')] });
        expect(done?.status).toBe('completed');
        expect(provider.created).toEqual([]);
    });
});

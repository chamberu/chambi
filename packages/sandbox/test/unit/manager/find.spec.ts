/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, RunStatus, SandboxError } from '@chamvi/core';
import type { Engine, Run, RunEvent } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { ISandboxProvider, WorkspaceManagerOptions } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { createFakeProvider } from '../../utils/provider.ts';
import type { FakeProvider } from '../../utils/provider.ts';

const REPO = 'https://github.com/octo/demo.git';

/** Lets already-queued callbacks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => {
    setImmediate(resolve);
});

/** Two managers over one provider: `first` creates, `second` is the replica (or the restarted process). */
function setup(options: Partial<WorkspaceManagerOptions> = {}) {
    const clock = new ControllableClock(new Date(1_000_000));
    const provider = createFakeProvider({ clock });
    const errors: unknown[] = [];
    const build = (extra: Partial<WorkspaceManagerOptions> = {}) => createWorkspaceManager({
        provider,
        clock,
        gcIntervalMs: 0,
        onError: (error) => {
            errors.push(error);
        },
        ...options,
        ...extra,
    });

    return {
        clock,
        provider,
        errors,
        first: build(),
        second: build(),
        build,
    };
}

/** An engine stand-in that records its run.updated listeners. */
function fakeEngine() {
    const listeners = new Set<(e: Extract<RunEvent, { type: 'run.updated' }>) => void>();

    return {
        on: ((type: string, listener: (e: Extract<RunEvent, { type: 'run.updated' }>) => void) => {
            if (type === 'run.updated') {
                listeners.add(listener);
            }

            return () => {
                listeners.delete(listener);
            };
        }) as Engine['on'],
        emit(run: Pick<Run, 'id' | 'status'>) {
            for (const listener of listeners) {
                listener({ type: 'run.updated', run: run as Run });
            }
        },
    };
}

function findsOf(provider: FakeProvider, runId: string) {
    return provider.findCalls.filter((call) => call.runId === runId);
}

describe('workspace manager: find', () => {
    it('adopts the run\'s workspace another process created, on get', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', { repo: 'octo/demo' });

        await expect(second.get('r1')).resolves.toBe(workspace);
        await expect(second.get('r1', workspace.id)).resolves.toBe(workspace);
        expect(provider.created).toHaveLength(1);
        expect(findsOf(provider, 'r1')).toHaveLength(2);
    });

    it('adopts on acquire and reports it reused', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', { repo: 'octo/demo' });

        const result = await second.acquire('r1', { repo: 'octo/demo' });

        expect(result).toEqual({ workspace, reused: true });
        expect(provider.created).toHaveLength(1);
    });

    it('never adopts a found workspace of a repository without its commit (a create that died during the checkout)', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace: half } = await first.acquire('r1', { repo: 'octo/demo' });

        // what a provider that does not check the checkout record would answer
        delete half.info.commit;

        const result = await second.acquire('r1', { repo: 'octo/demo' });

        expect(result.reused).toBe(false);
        expect(result.workspace).not.toBe(half);
        expect(result.workspace.info.commit).toBeDefined();
        expect(provider.created).toHaveLength(2);
        // left to the garbage collection, like a container that never started
        expect(provider.disposed).toEqual([]);
        await expect(second.get('r1')).resolves.toBe(result.workspace);
    });

    it('shares one lookup between concurrent misses of a run', async () => {
        const { provider, second } = setup();
        const [a, b] = await Promise.all([
            second.acquire('r1', { repo: 'octo/demo' }),
            second.acquire('r1', { repo: 'octo/other' }),
            second.get('r1').catch(() => undefined),
        ]);

        expect(a.workspace.id).not.toBe(b.workspace.id);
        expect(findsOf(provider, 'r1')).toHaveLength(1);
    });

    it('asks no lookup for a workspace it holds', async () => {
        const { provider, second } = setup();
        const { workspace } = await second.acquire('r1', {});

        await second.acquire('r1', {});
        await expect(second.get('r1')).resolves.toBe(workspace);
        await expect(second.get('r1', workspace.id)).resolves.toBe(workspace);
        expect(findsOf(provider, 'r1')).toHaveLength(1);
    });

    it('asks again for a run without a workspace on a later get', async () => {
        const {
            provider,
            first,
            second,
        } = setup();

        await expect(second.get('r1')).rejects.toThrow(/create_workspace first/);

        const { workspace } = await first.acquire('r1', {});

        await expect(second.get('r1')).resolves.toBe(workspace);
        // second's two misses and first's acquire
        expect(findsOf(provider, 'r1')).toHaveLength(3);
    });

    it('creates when the provider finds nothing', async () => {
        const { provider, second } = setup();
        const { reused } = await second.acquire('r1', { repo: 'octo/demo' });

        expect(reused).toBe(false);
        expect(findsOf(provider, 'r1')).toHaveLength(1);
        expect(provider.created).toHaveLength(1);
    });

    it('keeps the repository key of an adopted workspace', async () => {
        const { first, second } = setup();
        const { workspace } = await first.acquire('r1', { repo: 'octo/demo', ref: 'v1' });

        await expect(second.acquire('r1', { repo: 'octo/demo', ref: 'v2' })).rejects.toThrow(/already has a workspace/);
        expect(workspace.info.repo).toBe(REPO);
    });

    it('passes the deployment to create, find and the garbage collection', async () => {
        const { provider, build } = setup();
        const manager = build({ deployment: 'prod' });

        await manager.acquire('r1', {});
        await manager.collectGarbage();
        expect(provider.created[0]!.deployment).toBe('prod');
        expect(provider.findCalls[0]!.options?.deployment).toBe('prod');
        expect(provider.gcOptions[0]?.deployment).toBe('prod');

        const other = build();

        await other.acquire('r2', {});
        expect(provider.created[1]!.deployment).toBe('default');
    });

    it('never adopts a workspace of another deployment', async () => {
        const { provider, build } = setup();

        await build({ deployment: 'ci' }).acquire('r1', {});
        await expect(build({ deployment: 'prod' }).get('r1')).rejects.toThrow(/create_workspace first/);
        expect(provider.created).toHaveLength(1);
    });

    it('fails a lookup the provider fails with a SandboxError and asks again later', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', {});

        provider.failNextFind(new Error('docker down'));

        const error = await second.get('r1').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toBe('workspace lookup failed: docker down');
        await expect(second.get('r1')).resolves.toBe(workspace);
    });

    it('disposes what a lookup found when the run was released meanwhile', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', {});
        const { promise: gate, resolve: open } = Promise.withResolvers<void>();

        provider.findGate = gate;

        const pending = second.get('r1');
        const settled = expect(pending).rejects.toThrow(/released while it was looked up/);

        await flush();

        const releasing = second.release('r1');

        delete provider.findGate;
        open();
        await releasing;
        await settled;
        await flush();
        expect(provider.disposed).toEqual([workspace.id]);
    });

    it('leaves a second workspace of one repository unused until the run is released', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', { repo: 'octo/demo' });
        const extra = await provider.create({ runId: 'r1', repo: REPO });

        await expect(second.get('r1')).resolves.toBe(workspace);
        await flush();
        expect(provider.disposed).toEqual([]);
        await second.release('r1');
        expect(provider.disposed.sort()).toEqual([workspace.id, extra.id].sort());
    });

    it('attach disposes the workspaces of a settled run this process never held', async () => {
        const {
            provider,
            first,
            second,
        } = setup();
        const { workspace } = await first.acquire('r1', {});
        const engine = fakeEngine();

        second.attach(engine);

        engine.emit({ id: 'r1', status: RunStatus.COMPLETED });
        await flush();
        await flush();
        expect(provider.disposed).toEqual([workspace.id]);
    });

    it('attach looks a settled run up once and disposes nothing when it has no workspace', async () => {
        const { provider, second } = setup();
        const engine = fakeEngine();

        second.attach(engine);
        engine.emit({ id: 'r9', status: RunStatus.FAILED });
        await flush();
        await flush();
        expect(findsOf(provider, 'r9')).toHaveLength(1);
        expect(provider.disposed).toEqual([]);
    });

    it('attach with isSettled looks up no settled run this process never touched and leaves it to a collection', async () => {
        const isSettled = async () => true;
        const {
            provider,
            clock,
            build,
        } = setup({ isSettled, gcIntervalMs: 60_000 });
        const manager = build();
        const engine = fakeEngine();

        manager.attach(engine);

        engine.emit({ id: 'r8', status: RunStatus.COMPLETED });
        engine.emit({ id: 'r9', status: RunStatus.FAILED });
        await flush();
        await flush();
        expect(findsOf(provider, 'r8')).toEqual([]);
        expect(findsOf(provider, 'r9')).toEqual([]);
        // one collection per interval, whatever the number of settled runs
        expect(provider.gcCalls).toBe(1);
        expect(provider.gcOptions[0]?.isSettled).toBe(isSettled);

        clock.advance(60_000);
        engine.emit({ id: 'r7', status: RunStatus.CANCELLED });
        await flush();
        expect(provider.gcCalls).toBe(2);
    });

    it('attach with isSettled still releases a settled run it holds, also what another process created', async () => {
        const isSettled = async () => true;
        const { provider, build } = setup({ isSettled });
        const manager = build();
        const { workspace } = await manager.acquire('r1', {});
        const extra = await provider.create({ runId: 'r1', repo: REPO });
        const engine = fakeEngine();

        manager.attach(engine);

        engine.emit({ id: 'r1', status: RunStatus.COMPLETED });
        await flush();
        await flush();
        expect(provider.disposed.sort()).toEqual([workspace.id, extra.id].sort());
    });

    it('collectGarbage releases the settled runs it holds and hands isSettled to the provider', async () => {
        const settled = new Set(['r1']);
        const isSettled = async (runId: string) => settled.has(runId);
        const { provider, build } = setup();
        const manager = build({ isSettled });
        const a = await manager.acquire('r1', {});
        const b = await manager.acquire('r2', {});

        expect(await manager.collectGarbage()).toBe(1);
        expect(provider.disposed).toEqual([a.workspace.id]);
        expect(provider.gcOptions[0]?.isSettled).toBe(isSettled);
        await expect(manager.get('r2')).resolves.toBe(b.workspace);
    });

    it('collectGarbage keeps a run whose isSettled rejects and reports it', async () => {
        const failure = new Error('store down');
        const {
            provider,
            errors,
            build,
        } = setup();
        const manager = build({
            isSettled: async () => {
                throw failure;
            },
        });
        const { workspace } = await manager.acquire('r1', {});

        expect(await manager.collectGarbage()).toBe(0);
        expect(errors).toContain(failure);
        expect(provider.disposed).toEqual([]);
        await expect(manager.get('r1')).resolves.toBe(workspace);
    });

    it('refuses an invalid deployment, isSettled or a provider without find', () => {
        const provider = createFakeProvider();

        for (const deployment of ['', 'a b', 'x'.repeat(64), 7]) {
            expect(() => createWorkspaceManager({ provider, deployment: deployment as string })).toThrow(InvalidAgentDefinitionError);
        }

        expect(() => createWorkspaceManager({ provider, isSettled: 'yes' as never })).toThrow(InvalidAgentDefinitionError);

        const withoutFind = {
            name: 'x',
            create: provider.create,
            collectGarbage: provider.collectGarbage,
        } as unknown as ISandboxProvider;

        expect(() => createWorkspaceManager({ provider: withoutFind })).toThrow(/find/);
    });
});

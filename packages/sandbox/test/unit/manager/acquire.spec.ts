/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import {
    InvalidAgentDefinitionError,
    SandboxError,
    ValidationError,
} from '@chamvi/core';
import {
    CLOSE_TIMEOUT_MS,
    GC_INTERVAL_MS,
    createWorkspaceManager,
} from '@chamvi/sandbox';
import type { WorkspaceManagerOptions } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { createFakeProvider } from '../../utils/provider.ts';

/** Lets already-queued callbacks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

/** Flushes until `condition` holds (a lookup and a create each take a tick); at most 20 rounds. */
async function until(condition: () => boolean): Promise<void> {
    for (let round = 0; round < 20 && !condition(); round++) await flush();
    expect(condition()).toBe(true);
}

function setup(options: Partial<WorkspaceManagerOptions> = {}) {
    const clock = new ControllableClock(new Date(1_000_000));
    const provider = createFakeProvider({ clock });
    const errors: unknown[] = [];
    const manager = createWorkspaceManager({
        provider,
        clock,
        onError: (error) => { errors.push(error); },
        ...options,
    });
    return {
        clock,
        provider,
        manager,
        errors,
    };
}

describe('workspace manager: acquire', () => {
    it('reuses the workspace of a run and repo', async () => {
        const { provider, manager } = setup();
        const first = await manager.acquire('r1', { repo: 'octo/demo' });
        const second = await manager.acquire('r1', { repo: 'octo/demo' });
        expect(second.workspace.id).toBe(first.workspace.id);
        expect(first.reused).toBe(false);
        expect(second.reused).toBe(true);
        expect(provider.created).toHaveLength(1);
        expect(provider.created[0]!.repo).toBe('https://github.com/octo/demo.git');
        expect(provider.created[0]!.runId).toBe('r1');
    });

    it('treats the shorthand and the URL of a repository as one', async () => {
        const { provider, manager } = setup();
        const first = await manager.acquire('r1', { repo: 'octo/demo' });
        const second = await manager.acquire('r1', { repo: 'https://github.com/octo/demo.git' });
        expect(second.workspace.id).toBe(first.workspace.id);
        expect(provider.created).toHaveLength(1);
    });

    it('creates once for concurrent calls', async () => {
        const { provider, manager } = setup();
        const results = await Promise.all([
            manager.acquire('r1', {}),
            manager.acquire('r1', {}),
            manager.acquire('r1', {}),
        ]);
        expect(provider.created).toHaveLength(1);
        expect(new Set(results.map((r) => r.workspace.id)).size).toBe(1);
        expect(results.filter((r) => !r.reused)).toHaveLength(1);
    });

    it('passes image, env, limits and the signal to create', async () => {
        const controller = new AbortController();
        const { provider, manager } = setup({
            image: 'node:24',
            env: { FOO: 'bar' },
            limits: { memory: '1Gi' },
        });
        await manager.acquire('r1', {
            repo: 'octo/demo', 
            ref: 'v1', 
            signal: controller.signal, 
        });
        expect(provider.created[0]).toEqual({
            runId: 'r1',
            repo: 'https://github.com/octo/demo.git',
            ref: 'v1',
            image: 'node:24',
            env: { FOO: 'bar' },
            limits: { memory: '1Gi' },
            deployment: 'default',
            signal: expect.any(AbortSignal),
        });
        // the caller's signal reaches create
        const { signal } = provider.created[0]!;
        expect(signal!.aborted).toBe(false);
        controller.abort();
        expect(signal!.aborted).toBe(true);
    });

    it('refuses another ref for the same repo', async () => {
        const { manager } = setup();
        await manager.acquire('r1', { repo: 'octo/demo', ref: 'v1' });
        await expect(manager.acquire('r1', { repo: 'octo/demo', ref: 'v2' }))
            .rejects.toThrow(SandboxError);
        await expect(manager.acquire('r1', { repo: 'octo/demo', ref: 'v2' }))
            .rejects.toThrow(/dispose it first/);
        await expect(manager.acquire('r1', { repo: 'octo/demo' }))
            .rejects.toThrow(/dispose it first/);
    });

    it('keeps runs apart', async () => {
        const { provider, manager } = setup();
        const { workspace } = await manager.acquire('r1', {});
        await expect(manager.get('r2', workspace.id)).rejects.toThrow(SandboxError);
        await expect(manager.get('r2', workspace.id)).rejects.toThrow(/not found/);
        await expect(manager.release('r2', workspace.id)).rejects.toThrow(SandboxError);
        await expect(manager.release('r2', workspace.id)).rejects.toThrow(/not found/);
        expect(provider.disposed).toEqual([]);
        expect(await manager.get('r1', workspace.id)).toBe(workspace);
        await expect(manager.release('r2')).resolves.toBeUndefined();
        expect(provider.disposed).toEqual([]);
    });

    it('releases one workspace or all of a run', async () => {
        const { provider, manager } = setup();
        const a = await manager.acquire('r1', { repo: 'octo/a' });
        const b = await manager.acquire('r1', { repo: 'octo/b' });
        const c = await manager.acquire('r1', { repo: 'octo/c' });
        await manager.release('r1', a.workspace.id);
        expect(provider.disposed).toEqual([a.workspace.id]);
        await expect(manager.get('r1', a.workspace.id)).rejects.toThrow(/not found/);
        await manager.release('r1');
        expect([...provider.disposed].sort()).toEqual([a.workspace.id, b.workspace.id, c.workspace.id].sort());
        await expect(manager.get('r1')).rejects.toThrow(/create_workspace/);
    });

    it('caps workspaces per run', async () => {
        const { manager } = setup();
        await manager.acquire('r1', { repo: 'octo/a' });
        await manager.acquire('r1', { repo: 'octo/b' });
        await manager.acquire('r1', { repo: 'octo/c' });
        await expect(manager.acquire('r1', { repo: 'octo/d' })).rejects.toThrow(SandboxError);
        await expect(manager.acquire('r2', { repo: 'octo/d' })).resolves.toMatchObject({ reused: false });
    });

    it('counts a pending create toward the cap', async () => {
        const { provider, manager } = setup({ maxWorkspacesPerRun: 1 });
        const first = manager.acquire('r1', { repo: 'octo/a' });
        await expect(manager.acquire('r1', { repo: 'octo/b' })).rejects.toThrow(SandboxError);
        await first;
        expect(provider.created).toHaveLength(1);
    });

    it('validates repo input', async () => {
        const { provider, manager } = setup({ allowRepo: (url) => url.includes('/octo/') });
        await expect(manager.acquire('r1', { repo: 'file:///tmp/x' })).rejects.toThrow(ValidationError);
        await expect(manager.acquire('r1', { repo: 'other/x' })).rejects.toThrow(ValidationError);
        const error = await manager.acquire('r1', { repo: 'https://u:tok@github.com/o/r' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as Error).message).not.toContain('tok');
        await expect(manager.acquire('r1', { repo: 'octo/demo', ref: '--upload-pack=touch /tmp/x' })).rejects.toThrow(ValidationError);
        await expect(manager.acquire('r1', { repo: 'octo/demo', ref: 'a..b' })).rejects.toThrow(ValidationError);
        await expect(manager.acquire('r1', { ref: 'main' })).rejects.toThrow(ValidationError);
        expect(provider.created).toEqual([]);

        const files = setup({ allowFileRepos: true });
        await expect(files.manager.acquire('r1', { repo: 'file:///tmp/x' })).resolves.toMatchObject({ reused: false });
        expect(files.provider.created[0]!.repo).toBe('file:///tmp/x');
    });

    it('does not cache a failed create', async () => {
        const { provider, manager } = setup();
        provider.failNextCreate(new SandboxError('boom'));
        await expect(manager.acquire('r1', {})).rejects.toThrow('boom');
        await expect(manager.acquire('r1', {})).resolves.toMatchObject({ reused: false });
        expect(provider.created).toHaveLength(2);
    });

    it('wraps a provider failure that is no SandboxError', async () => {
        const { provider, manager } = setup();
        provider.failNextCreate(new Error('daemon unreachable'));
        const error = await manager.acquire('r1', {}).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toMatch(/daemon unreachable/);
    });

    it('get without an id', async () => {
        const { manager } = setup();
        await expect(manager.get('r1')).rejects.toThrow(SandboxError);
        await expect(manager.get('r1')).rejects.toThrow(/create_workspace/);
        const a = await manager.acquire('r1', { repo: 'octo/a' });
        expect(await manager.get('r1')).toBe(a.workspace);
        const b = await manager.acquire('r1', { repo: 'octo/b' });
        await expect(manager.get('r1')).rejects.toThrow(ValidationError);
        let message = '';
        try {
            await manager.get('r1');
        } catch (error) {
            message = (error as Error).message;
        }
        expect(message).toContain(a.workspace.id);
        expect(message).toContain(b.workspace.id);
    });

    it('expires workspaces', async () => {
        const {
            clock, 
            provider, 
            manager, 
        } = setup({ limits: { maxLifetimeMs: 60_000 } });
        const { workspace } = await manager.acquire('r1', {});
        clock.advance(59_999);
        expect(await manager.get('r1', workspace.id)).toBe(workspace);
        clock.advance(1);
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(SandboxError);
        await flush();
        expect(provider.disposed).toEqual([workspace.id]);
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(/not found/);
        const again = await manager.acquire('r1', {});
        expect(again.reused).toBe(false);
        expect(provider.created).toHaveLength(2);
    });

    it('reports an expired workspace as expired', async () => {
        const { clock, manager } = setup({ limits: { maxLifetimeMs: 60_000 } });
        const { workspace } = await manager.acquire('r1', {});
        clock.advance(60_000);
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(/expired/);
    });

    it('creates anew on acquire when the workspace expired', async () => {
        const {
            clock, 
            provider, 
            manager, 
        } = setup({ limits: { maxLifetimeMs: 60_000 } });
        const first = await manager.acquire('r1', {});
        clock.advance(60_000);
        const second = await manager.acquire('r1', {});
        expect(second.reused).toBe(false);
        expect(second.workspace.id).not.toBe(first.workspace.id);
        expect(provider.disposed).toEqual([first.workspace.id]);
    });

    it('throttles garbage collection', async () => {
        const {
            clock,
            provider,
            manager,
            errors,
        } = setup();
        await manager.acquire('r1', {});
        await manager.acquire('r2', {});
        expect(provider.gcCalls).toBe(1);
        clock.advance(GC_INTERVAL_MS);
        await manager.acquire('r3', {});
        expect(provider.gcCalls).toBe(2);

        const gcError = new Error('list failed');
        provider.failNextGc(gcError);
        clock.advance(GC_INTERVAL_MS);
        await expect(manager.acquire('r4', {})).resolves.toMatchObject({ reused: false });
        await flush();
        expect(provider.gcCalls).toBe(3);
        expect(errors).toEqual([gcError]);
    });

    it('does not collect garbage on acquire with gcIntervalMs 0', async () => {
        const { provider, manager } = setup({ gcIntervalMs: 0 });
        await manager.acquire('r1', {});
        expect(provider.gcCalls).toBe(0);
        await expect(manager.collectGarbage()).resolves.toBe(0);
        expect(provider.gcCalls).toBe(1);
    });

    it('collects its own expired workspaces too', async () => {
        const {
            clock, 
            provider, 
            manager, 
        } = setup({ limits: { maxLifetimeMs: 60_000 }, gcIntervalMs: 0 });
        const { workspace } = await manager.acquire('r1', {});
        clock.advance(60_000);
        await expect(manager.collectGarbage()).resolves.toBe(1);
        expect(provider.disposed).toEqual([workspace.id]);
    });

    it('disposes its own expired workspaces before the provider collects', async () => {
        const {
            clock,
            provider,
            manager,
        } = setup({ limits: { maxLifetimeMs: 60_000 }, gcIntervalMs: 0 });
        const { workspace } = await manager.acquire('r1', {});
        clock.advance(60_000);
        const collect = provider.collectGarbage.bind(provider);
        let disposedBeforeGc: string[] | undefined;
        provider.collectGarbage = async () => {
            disposedBeforeGc = [...provider.disposed];
            return collect();
        };
        await expect(manager.collectGarbage()).resolves.toBe(1);
        expect(disposedBeforeGc).toEqual([workspace.id]);
    });

    it('picks the only live workspace when another one expired', async () => {
        const {
            clock,
            provider,
            manager,
            errors,
        } = setup({ limits: { maxLifetimeMs: 60_000 }, gcIntervalMs: 0 });
        const old = await manager.acquire('r1', { repo: 'octo/demo' });
        clock.advance(30_000);
        const live = await manager.acquire('r1', { repo: 'octo/other' });
        clock.advance(30_000);
        expect(await manager.get('r1')).toBe(live.workspace);
        await flush();
        expect(provider.disposed).toEqual([old.workspace.id]);
        expect(errors).toEqual([]);
    });

    it('reports the only workspace as expired when get has no id', async () => {
        const { clock, manager } = setup({ limits: { maxLifetimeMs: 60_000 } });
        await manager.acquire('r1', {});
        clock.advance(60_000);
        await expect(manager.get('r1')).rejects.toThrow(/expired/);
        await expect(manager.get('r1')).rejects.toThrow(/create_workspace first/);
    });

    it('creates anew on acquire when the workspace died outside the manager', async () => {
        const { provider, manager } = setup();
        const first = await manager.acquire('r1', { repo: 'octo/demo' });
        // e.g. the provider's own collection disposed it, or its container stopped
        await first.workspace.dispose();
        expect(first.workspace.disposed).toBe(true);

        const second = await manager.acquire('r1', { repo: 'octo/demo' });
        expect(second.reused).toBe(false);
        expect(second.workspace.id).not.toBe(first.workspace.id);
        expect(second.workspace.disposed).toBe(false);
        expect(provider.created).toHaveLength(2);
        expect(await manager.get('r1')).toBe(second.workspace);
    });

    it('reports a workspace that died outside the manager as gone', async () => {
        const { manager } = setup();
        const { workspace } = await manager.acquire('r1', {});
        await workspace.dispose();
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(/gone/);
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(/not found/);

        const other = await manager.acquire('r2', {});
        await other.workspace.dispose();
        await expect(manager.get('r2')).rejects.toThrow(/gone.*create_workspace/);
        await expect(manager.get('r2')).rejects.toThrow(/create_workspace first/);
    });

    it('does not count a workspace that died outside the manager as collected', async () => {
        const { manager } = setup();
        const { workspace } = await manager.acquire('r1', {});
        await workspace.dispose();
        expect(await manager.collectGarbage()).toBe(0);
        await expect(manager.get('r1', workspace.id)).rejects.toThrow(/not found/);
    });

    it('refuses to acquire and get after close, keeping the workspaces of live runs', async () => {
        const { provider, manager } = setup();
        await manager.acquire('r1', {});
        await manager.close();
        expect(provider.disposed).toEqual([]);
        await expect(manager.acquire('r1', {})).rejects.toThrow(SandboxError);
        await expect(manager.get('r1')).rejects.toThrow(/closed/);
    });

    it('disposes a workspace whose run was released while it was created', async () => {
        const { provider, manager } = setup();
        const { promise: gate, resolve: open } = Promise.withResolvers<void>();
        provider.gate = gate;
        const pending = manager.acquire('r1', {});
        const rejected = expect(pending).rejects.toThrow(SandboxError);
        await until(() => provider.created.length === 1);
        const releasing = manager.release('r1');
        open();
        await releasing;
        await rejected;
        expect(provider.disposed).toHaveLength(1);
        await expect(manager.get('r1')).rejects.toThrow(/create_workspace/);
    });

    it('close() waits for a create in flight, aborts it and disposes what it made', async () => {
        const {
            provider, 
            manager, 
            errors, 
        } = setup();
        const { promise: gate, resolve: open } = Promise.withResolvers<void>();
        provider.gate = gate;
        const pending = manager.acquire('r1', {});
        const outcome = pending.catch((error: unknown) => error);
        await until(() => provider.created.length === 1);

        let closed = false;
        const closing = manager.close().then(() => { closed = true; });
        await flush();
        expect(provider.created[0]!.signal!.aborted).toBe(true);
        expect(closed).toBe(false);

        open();
        await closing;
        expect(await outcome).toBeInstanceOf(SandboxError);
        expect(provider.disposed).toHaveLength(1);
        expect(errors).toEqual([]);
    });

    it('release(runId) waits for the run\'s creates in flight', async () => {
        const { provider, manager } = setup();
        const { promise: gate, resolve: open } = Promise.withResolvers<void>();
        provider.gate = gate;
        const pending = manager.acquire('r1', {}).catch((error: unknown) => error);
        await until(() => provider.created.length === 1);

        let released = false;
        const releasing = manager.release('r1').then(() => { released = true; });
        await flush();
        expect(provider.created[0]!.signal!.aborted).toBe(true);
        expect(released).toBe(false);
        open();
        await releasing;
        expect(provider.disposed).toHaveLength(1);
        expect(await pending).toBeInstanceOf(SandboxError);
    });

    it('close() gives up on a hanging dispose after timeoutMs and reports it', async () => {
        const {
            clock,
            provider,
            manager,
            errors,
        } = setup();
        const { workspace } = await manager.acquire('r1', {});
        provider.workspaces.get(workspace.id)!.dispose = () => new Promise<void>(() => {
            // the daemon hangs
        });
        manager.release('r1', workspace.id).catch(() => undefined);

        let closed = false;
        const closing = manager.close({ timeoutMs: 5_000 }).then(() => { closed = true; });
        await flush();
        clock.advance(4_999);
        await flush();
        expect(closed).toBe(false);
        clock.advance(1);
        await closing;
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(SandboxError);
        expect((errors[0] as Error).message).toContain(workspace.id);
        await expect(manager.acquire('r1', {})).rejects.toThrow(/closed/);
    });

    it('close() defaults to CLOSE_TIMEOUT_MS', async () => {
        const {
            clock,
            provider,
            manager,
            errors,
        } = setup();
        const { workspace } = await manager.acquire('r1', {});
        provider.workspaces.get(workspace.id)!.dispose = () => new Promise<void>(() => {
            // the daemon hangs
        });
        manager.release('r1', workspace.id).catch(() => undefined);
        const closing = manager.close();
        await flush();
        clock.advance(CLOSE_TIMEOUT_MS);
        await closing;
        expect(errors).toHaveLength(1);
    });

    it('close() rejects an invalid timeoutMs', async () => {
        const { manager } = setup();
        await expect(manager.close({ timeoutMs: -1 })).rejects.toThrow(InvalidAgentDefinitionError);
    });

    it('rejects invalid options', () => {
        const provider = createFakeProvider();
        expect(() => createWorkspaceManager({ provider, maxWorkspacesPerRun: 0 })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider, maxWorkspacesPerRun: 1.5 })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider, env: { 'A B': 'x' } })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider, gcIntervalMs: -1 })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider, limits: { pids: 0 } })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider, image: '' })).toThrow(InvalidAgentDefinitionError);
        expect(() => createWorkspaceManager({ provider: {} as never })).toThrow(InvalidAgentDefinitionError);
    });
});

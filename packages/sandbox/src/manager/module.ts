/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    InvalidAgentDefinitionError,
    SandboxError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import type { ToolSet } from 'ai';
import { DEFAULT_DEPLOYMENT } from '../provider/constants.ts';
import type { GarbageCollectOptions, WorkspaceCreateOptions } from '../provider/types.ts';
import { assertGitRef, normalizeRepo } from '../repo/module.ts';
import type { IWorkspace } from '../workspace/types.ts';
import { CLOSE_TIMEOUT_MS, GC_INTERVAL_MS, MAX_WORKSPACES_PER_RUN } from './constants.ts';
import {
    assertManagerOptions,
    isExpired,
    isTerminal,
    toSandboxError,
} from './helpers.ts';
import { createWorkspaceTools } from './tools.ts';
import type {
    AcquireInput,
    AcquireResult,
    CloseOptions,
    IWorkspaceManager,
    WorkspaceManagerOptions,
} from './types.ts';

/** One workspace slot of a run: keyed by the normalized repository URL, or '' without one. */
type Entry = {
    key: string;
    ref?: string;
    workspace?: IWorkspace;
    /** Set while the provider creates the workspace; a pending entry counts toward the cap. */
    pending?: Promise<IWorkspace>;
    /** Aborts the create in flight (combined with the caller's signal); release and close abort it. */
    abort?: AbortController;
};

const NOT_FOUND = 'workspace not found in this run (disposed, expired or never created); call create_workspace for a new one.';

/** What `pick` answers when the run holds no workspace that fits: look the run up, then pick again. */
const MISS = Symbol('miss');

/**
 * Run-scoped workspaces over `provider`: one per (run, repository), created
 * on `acquire`, disposed on `release`, on expiry (checked on every get), once
 * found gone (`IWorkspace.disposed`, dropped on every get and acquire), when
 * the run settles (`attach`, also the ones another process created) and by
 * garbage collection. On a miss the manager asks `provider.find` (one lookup
 * per run at a time) and adopts what it finds, so a run reaches its
 * workspaces after a restart or on another replica. `close()` disposes
 * nothing a live run holds. A run can only ever reach its own workspaces.
 */
export function createWorkspaceManager(options: WorkspaceManagerOptions): IWorkspaceManager {
    assertManagerOptions(options);
    const { provider } = options;
    const clock = options.clock ?? systemClock;
    const maxPerRun = options.maxWorkspacesPerRun ?? MAX_WORKSPACES_PER_RUN;
    const gcIntervalMs = options.gcIntervalMs ?? GC_INTERVAL_MS;
    const deployment = options.deployment ?? DEFAULT_DEPLOYMENT;
    const { isSettled } = options;
    // eslint-disable-next-line no-console
    const onError = options.onError ?? ((error: unknown) => console.error('[chamvi]', error));

    const runs = new Map<string, Map<string, Entry>>();
    /** The lookup in flight per run; concurrent misses share it. */
    const lookups = new Map<string, Promise<void>>();
    /** Bumped by a release of a whole run while its lookup runs: that lookup disposes what it found. */
    const generations = new Map<string, number>();
    const subscriptions = new Set<() => void>();
    let lastGcAt: number | undefined;
    let closed = false;
    let tools: ToolSet | undefined;

    /** Every disposal started and not settled yet, with its workspace id: close() waits for them. */
    const disposals = new Map<Promise<void>, string>();

    const disposeOrThrow = (workspace: IWorkspace): Promise<void> => {
        const disposal = (async () => {
            try {
                await workspace.dispose();
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new SandboxError(`workspace dispose failed: ${message}`, { cause: error });
            }
        })();
        disposals.set(disposal, workspace.id);
        const settled = () => {
            disposals.delete(disposal);
        };
        disposal.then(settled, settled);
        return disposal;
    };

    /**
     * Every create in flight a release aborted, with its label: close() waits
     * for them, since a run released by attach is no longer in `runs` while
     * the provider's abort cleanup, or the dispose of a workspace created
     * anyway, still runs.
     */
    const releasedCreates = new Map<Promise<unknown>, string>();

    const trackReleasedCreate = (runId: string, pending: Promise<IWorkspace>): void => {
        const tracked = pending.then(() => undefined, () => undefined);
        releasedCreates.set(tracked, `a workspace of run ${runId} still being created`);
        tracked.then(() => { releasedCreates.delete(tracked); });
    };

    const disposeInBackground = (workspace: IWorkspace): void => {
        disposeOrThrow(workspace).catch(onError);
    };

    /** Removes `entry` from its run, dropping the run when it holds nothing more. */
    const forget = (runId: string, entry: Entry): void => {
        const entries = runs.get(runId);
        if (!entries || entries.get(entry.key) !== entry) return;
        entries.delete(entry.key);
        if (entries.size === 0) runs.delete(runId);
    };

    /** Forgets every expired or gone workspace of the run; returns them for disposal. */
    const sweep = (runId: string): IWorkspace[] => {
        const now = clock.now();
        const expired: IWorkspace[] = [];
        for (const entry of runs.get(runId)?.values() ?? []) {
            if (entry.workspace && (entry.workspace.disposed || isExpired(entry.workspace, now))) {
                forget(runId, entry);
                expired.push(entry.workspace);
            }
        }
        return expired;
    };

    const heldEntries = (runId: string): Entry[] => [...runs.get(runId)?.values() ?? []]
        .filter((entry) => entry.workspace !== undefined);

    const collectGarbage = async (): Promise<number> => {
        lastGcAt = clock.now().getTime();
        const expired = runs.keys().toArray().flatMap((runId) => sweep(runId));
        // a workspace found gone may still leave a stopped container behind,
        // but only the expired live ones count as collected here
        const counted = expired.filter((workspace) => !workspace.disposed).length;
        // own disposals first: the provider's collection would find the same
        // expired workspaces, count them twice and dispose them concurrently
        const disposed = await Promise.allSettled(expired.map((workspace) => disposeOrThrow(workspace)));
        for (const result of disposed) {
            if (result.status === 'rejected') onError(result.reason);
        }
        let settled = 0;
        if (isSettled) {
            for (const runId of runs.keys().toArray()) {
                try {
                    if (!await isSettled(runId)) continue;
                } catch (error) {
                    onError(error);
                    continue;
                }
                settled += heldEntries(runId).length;
                await release(runId).catch(onError);
            }
        }
        const gcOptions: GarbageCollectOptions = { deployment };
        if (isSettled) gcOptions.isSettled = isSettled;
        return counted + settled + await provider.collectGarbage(gcOptions);
    };

    const maybeCollectGarbage = (): void => {
        if (gcIntervalMs === 0) return;
        const now = clock.now().getTime();
        if (lastGcAt !== undefined && now - lastGcAt < gcIntervalMs) return;
        collectGarbage().catch(onError);
    };

    const create = (runId: string, entries: Map<string, Entry>, entry: Entry, input: AcquireInput): Promise<IWorkspace> => {
        const createOptions: WorkspaceCreateOptions = { runId };
        if (entry.key !== '') createOptions.repo = entry.key;
        if (entry.ref !== undefined) createOptions.ref = entry.ref;
        if (options.image !== undefined) createOptions.image = options.image;
        if (options.env !== undefined) createOptions.env = options.env;
        if (options.limits !== undefined) createOptions.limits = options.limits;
        createOptions.deployment = deployment;
        entry.abort = new AbortController();
        createOptions.signal = input.signal === undefined ?
            entry.abort.signal :
            AbortSignal.any([input.signal, entry.abort.signal]);

        return (async () => {
            let workspace: IWorkspace;
            try {
                workspace = await provider.create(createOptions);
            } catch (error) {
                delete entry.pending;
                delete entry.abort;
                forget(runId, entry);
                throw toSandboxError(error, 'workspace create failed');
            }
            delete entry.pending;
            delete entry.abort;
            if (runs.get(runId) !== entries || entries.get(entry.key) !== entry) {
                // released (run settled, dispose_workspace, close) while the provider created it
                await disposeOrThrow(workspace).catch(onError);
                throw new SandboxError('workspace released while it was created; call create_workspace again.');
            }
            entry.workspace = workspace;
            return workspace;
        })();
    };

    /** Holds what a lookup found: one workspace per repository key, never over one held or being created. */
    const adopt = (runId: string, found: readonly IWorkspace[]): void => {
        const now = clock.now();
        let entries = runs.get(runId);
        for (const workspace of found) {
            if (workspace.info.runId !== runId || workspace.disposed || isExpired(workspace, now)) continue;
            const key = workspace.info.repo ?? '';
            // a second workspace of one key (a crash between two creates) stays
            // unused; the release of the settled run disposes it
            if (entries?.has(key)) continue;
            if (!entries) {
                entries = new Map();
                runs.set(runId, entries);
            }
            const entry: Entry = { key, workspace };
            if (workspace.info.ref !== undefined) entry.ref = workspace.info.ref;
            entries.set(key, entry);
        }
    };

    const generationOf = (runId: string): number => generations.get(runId) ?? 0;

    /** Asks the provider for the run's workspaces and adopts them; concurrent callers share one lookup. */
    const lookup = (runId: string): Promise<void> => {
        if (closed) return Promise.reject(new SandboxError('the workspace manager is closed.'));
        const inFlight = lookups.get(runId);
        if (inFlight) return inFlight;

        const generation = generationOf(runId);
        const pending = (async () => {
            let found: IWorkspace[];
            try {
                found = await provider.find(runId, { deployment });
            } catch (error) {
                throw toSandboxError(error, 'workspace lookup failed');
            }
            if (generationOf(runId) !== generation) {
                // the run was released (settled) meanwhile: what it still had goes
                for (const workspace of found) disposeInBackground(workspace);
                throw new SandboxError('workspace released while it was looked up; call create_workspace again.');
            }
            // closed meanwhile: the workspaces stay for their runs
            if (closed) throw new SandboxError('the workspace manager is closed.');
            adopt(runId, found);
        })();
        lookups.set(runId, pending);
        const done = () => {
            if (lookups.get(runId) !== pending) return;
            lookups.delete(runId);
            // a release only bumps the generation while a lookup runs
            generations.delete(runId);
        };
        pending.then(done, done);
        return pending;
    };

    const acquire = async (runId: string, input: AcquireInput): Promise<AcquireResult> => {
        if (closed) throw new SandboxError('the workspace manager is closed.');
        const repo = input.repo === undefined ?
            undefined :
            normalizeRepo(input.repo, { allowFileRepos: options.allowFileRepos, allowRepo: options.allowRepo });
        const { ref } = input;
        if (ref !== undefined) {
            if (repo === undefined) throw new ValidationError('ref needs a repo.');
            assertGitRef(ref);
        }
        const key = repo ?? '';

        maybeCollectGarbage();
        for (const workspace of sweep(runId)) disposeInBackground(workspace);

        const reuse = async (existing: Entry): Promise<AcquireResult> => {
            if (existing.ref !== ref) {
                throw new SandboxError(`This run already has a workspace of ${repo ?? 'no repository'} at ${existing.ref ?? 'the default branch'}; ` +
                    `dispose it first (dispose_workspace) to check out ${ref ?? 'the default branch'}.`);
            }
            const workspace = existing.workspace ?? await existing.pending!;
            return { workspace, reused: true };
        };

        const held = runs.get(runId)?.get(key);
        if (held) return reuse(held);

        // another process (a replica, or this one before a restart) may hold it
        await lookup(runId);
        if (closed) throw new SandboxError('the workspace manager is closed.');
        let entries = runs.get(runId);
        const existing = entries?.get(key);
        if (existing) return reuse(existing);

        if (entries && entries.size >= maxPerRun) {
            throw new SandboxError(`A run holds at most ${maxPerRun} workspaces; dispose one first (dispose_workspace).`);
        }
        if (!entries) {
            entries = new Map();
            runs.set(runId, entries);
        }
        const entry: Entry = { key, ref };
        entries.set(key, entry);
        entry.pending = create(runId, entries, entry, input);
        return { workspace: await entry.pending, reused: false };
    };

    /** Why `workspace` can no longer be used: gone (disposed outside the manager, container stopped) or expired. */
    const deadError = (workspace: IWorkspace): SandboxError => new SandboxError(workspace.disposed ?
        `workspace ${workspace.id} is gone (disposed, or its container, pod or directory stopped or was removed); call create_workspace for a new one.` :
        `workspace ${workspace.id} expired at ${workspace.info.expiresAt.toISOString()} and was disposed; call create_workspace for a new one.`);

    /** The workspace `get` answers from what the run holds, or MISS when only a lookup can tell. */
    const pick = (runId: string, workspaceId: string | undefined, looked: boolean): IWorkspace | typeof MISS => {
        let entry: Entry | undefined;
        if (workspaceId === undefined) {
            // only live workspaces count when picking the run's one workspace
            const expired = sweep(runId);
            // the reason before the disposal: a disposed workspace reads as gone
            const dead = expired.length > 0 ? deadError(expired[0]!) : undefined;
            for (const workspace of expired) disposeInBackground(workspace);
            const held = heldEntries(runId);
            if (held.length === 0) {
                if (dead) throw dead;
                if (!looked) return MISS;
                throw new SandboxError('This run has no workspace; call create_workspace first.');
            }
            if (held.length > 1) {
                const ids = held.map((e) => e.workspace!.id).join(', ');
                throw new ValidationError(`This run has ${held.length} workspaces (${ids}); pass workspace to pick one.`);
            }
            [entry] = held;
        } else {
            entry = heldEntries(runId).find((e) => e.workspace!.id === workspaceId);
            if (!entry) {
                if (!looked) return MISS;
                throw new SandboxError(NOT_FOUND);
            }
        }

        const workspace = entry!.workspace!;
        if (workspace.disposed || isExpired(workspace, clock.now())) {
            const dead = deadError(workspace);
            forget(runId, entry!);
            disposeInBackground(workspace);
            throw dead;
        }
        return workspace;
    };

    const get = async (runId: string, workspaceId?: string): Promise<IWorkspace> => {
        const picked = pick(runId, workspaceId, false);
        if (picked !== MISS) return picked;
        await lookup(runId);
        return pick(runId, workspaceId, true) as IWorkspace;
    };

    const release = async (runId: string, workspaceId?: string): Promise<void> => {
        if (workspaceId !== undefined) {
            const held = () => heldEntries(runId).find((e) => e.workspace!.id === workspaceId);
            let entry = held();
            if (!entry) {
                await lookup(runId);
                entry = held();
            }
            if (!entry) throw new SandboxError(NOT_FOUND);
            forget(runId, entry);
            await disposeOrThrow(entry.workspace!);
            return;
        }

        // a lookup in flight disposes what it finds instead of adopting it
        if (lookups.has(runId)) generations.set(runId, generationOf(runId) + 1);
        const entries = runs.get(runId) ?? new Map<string, Entry>();
        runs.delete(runId);
        // pending creates are aborted, see their run gone and dispose what they
        // get; waiting for them keeps a container from outliving the release
        const pending = entries.values().toArray().flatMap((entry) => {
            if (!entry.pending) return [];
            entry.abort?.abort();
            trackReleasedCreate(runId, entry.pending);
            return [entry.pending];
        });
        const held = entries.values().toArray().flatMap((entry) => (entry.workspace ? [entry.workspace] : []));
        const results = await Promise.allSettled(held.map((workspace) => disposeOrThrow(workspace)));
        // their rejections belong to their acquire callers
        await Promise.allSettled(pending);

        // what other processes created for the run (or this one before a restart)
        const ids = new Set(held.map((workspace) => workspace.id));
        const rest = await provider.find(runId, { deployment }).then(
            (found) => Promise.allSettled(found
                .filter((workspace) => !ids.has(workspace.id) && workspace.info.runId === runId)
                .map((workspace) => disposeOrThrow(workspace))),
            (error: unknown) => [{ status: 'rejected', reason: toSandboxError(error, 'workspace lookup failed') } as PromiseRejectedResult],
        );
        const failed = [...results, ...rest].find((result) => result.status === 'rejected');
        if (failed) throw failed.reason;
    };

    const attach = (engine: Parameters<IWorkspaceManager['attach']>[0]): () => void => {
        // a closed manager holds nothing and acquires nothing: nothing to dispose
        if (closed) return () => {};
        const off = engine.on('run.updated', ({ run }) => {
            if (isTerminal(run.status)) release(run.id).catch(onError);
        });
        let active = true;
        const unsubscribe = () => {
            if (!active) return;
            active = false;
            subscriptions.delete(unsubscribe);
            off();
        };
        subscriptions.add(unsubscribe);
        return unsubscribe;
    };

    const manager: IWorkspaceManager = {
        acquire,
        get,
        release,
        attach,
        tools: () => {
            tools ??= createWorkspaceTools(manager);
            return tools;
        },
        collectGarbage,
        async close(closeOptions: CloseOptions = {}) {
            const timeoutMs = closeOptions?.timeoutMs ?? CLOSE_TIMEOUT_MS;
            if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0) {
                throw new InvalidAgentDefinitionError(`close() timeoutMs must be an integer of at least 0, got ${JSON.stringify(timeoutMs)}.`);
            }
            closed = true;
            for (const unsubscribe of [...subscriptions]) unsubscribe();

            // what is still being disposed or created, for the timeout report:
            // one key per item, as several items of a run share a label
            const left = new Map<object, string>();
            const track = (labels: string[], promise: Promise<unknown>): Promise<unknown> => {
                const keys = labels.map((label) => {
                    const key = {};
                    left.set(key, label);
                    return key;
                });
                return promise.finally(() => {
                    for (const key of keys) left.delete(key);
                });
            };
            // disposals started before (a settled run, an expired or gone
            // workspace): their runs are no longer held, but their containers
            // must not outlive the close
            const started = disposals.entries().toArray()
                .map(([disposal, id]) => track([id], disposal.catch(() => undefined)));
            // creates in flight of runs released before (attach): their
            // abort cleanup or the dispose of what they got anyway
            const creating = releasedCreates.entries().toArray()
                .map(([pending, label]) => track([label], pending));
            // the workspaces of live runs stay (their runs resume after a
            // restart or on another replica and find them); creates in flight
            // are aborted and what they made anyway is disposed
            const work = runs.entries().toArray().flatMap(([runId, entries]) => entries.values().toArray()
                .flatMap((entry) => {
                    if (!entry.pending) return [];
                    entry.abort?.abort();
                    return [track([`a workspace of run ${runId} still being created`], entry.pending.catch(() => undefined))];
                }));
            runs.clear();

            let timer: { clear(): void } | undefined;
            const timedOut = await Promise.race([
                Promise.all([...started, ...creating, ...work]).then(() => false),
                new Promise<boolean>((resolve) => {
                    timer = clock.setTimeout(() => resolve(true), timeoutMs);
                }),
            ]);
            timer?.clear();
            if (timedOut && left.size > 0) {
                onError(new SandboxError(`workspace manager close() gave up after ${timeoutMs} ms; still disposing: ${left.values().toArray().join(', ')}`));
            }
        },
    };
    return manager;
}

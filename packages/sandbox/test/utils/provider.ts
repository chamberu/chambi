/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { systemClock } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { DEFAULT_DEPLOYMENT, DEFAULT_LIMITS } from '@chamvi/sandbox';
import type {
    ExecOptions,
    ExecResult,
    GarbageCollectOptions,
    ISandboxProvider,
    IWorkspace,
    WorkspaceCreateOptions,
    WorkspaceFindOptions,
} from '@chamvi/sandbox';
import { createScriptedWorkspace } from './workspace.ts';
import type { ScriptedWorkspace } from './workspace.ts';

/** The commit every fake checkout reports. */
export const FAKE_COMMIT = '0123456789abcdef0123456789abcdef01234567';

export type FakeProvider = ISandboxProvider & {
    created: WorkspaceCreateOptions[];
    /** Ids of disposed workspaces, in dispose order (each once). */
    disposed: string[];
    gcCalls: number;
    /** The options of every collectGarbage() call. */
    gcOptions: Array<GarbageCollectOptions | undefined>;
    /** Every find() call: the run and its options. */
    findCalls: Array<{ runId: string; options?: WorkspaceFindOptions }>;
    /** Finds wait for this promise (after recording their input) while it is set. */
    findGate?: Promise<void>;
    /** The next find() rejects with `error`. */
    failNextFind(error: Error): void;
    /** The deployment each workspace was created in, by id. */
    deployments: Map<string, string>;
    /** Every workspace the provider handed out, by id. */
    workspaces: Map<string, ScriptedWorkspace>;
    failNextCreate(error: Error): void;
    /** Creates wait for this promise (after recording their input) while it is set. */
    gate?: Promise<void>;
    /** The next collectGarbage() rejects with `error`. */
    failNextGc(error: Error): void;
    /**
     * Makes the handle of workspace `id` gone (its container stopped) without
     * disposing it. The next find answers a fresh handle of it with its files
     * (the container restarted), unless `removed` (nothing left to find).
     */
    stop(id: string, options?: { removed?: boolean }): void;
};

/**
 * An in-memory provider: scripted workspaces with uuid ids, `info.commit`
 * set when a repo is given, expiry `limits.maxLifetimeMs` (default
 * DEFAULT_LIMITS.maxLifetimeMs) after the clock's now. `find` answers the
 * live, unexpired workspaces of the run and deployment it handed out.
 * With `image`, a create without one records that image (a container
 * provider's default), else none (like local).
 */
export function createFakeProvider(options: {
    clock?: IClock;
    image?: string;
    /** Answers every exec of every workspace (default: exit 0, no output). */
    onExec?: (argv: readonly string[], options: ExecOptions) => Partial<ExecResult>;
} = {}): FakeProvider {
    const clock = options.clock ?? systemClock;
    let nextCreateError: Error | undefined;
    let nextGcError: Error | undefined;
    let nextFindError: Error | undefined;
    /** Records the first dispose of `workspace` in `provider.disposed`. */
    const track = (workspace: ScriptedWorkspace): ScriptedWorkspace => {
        const dispose = workspace.dispose.bind(workspace);
        let recorded = false;
        workspace.dispose = async () => {
            // a stopped (gone) handle's dispose counts too: it removes the container
            if (!recorded) provider.disposed.push(workspace.id);
            recorded = true;
            await dispose();
        };
        provider.workspaces.set(workspace.id, workspace);
        return workspace;
    };
    const provider: FakeProvider = {
        name: 'fake',
        created: [],
        disposed: [],
        gcCalls: 0,
        gcOptions: [],
        findCalls: [],
        deployments: new Map(),
        workspaces: new Map(),
        failNextFind(error) {
            nextFindError = error;
        },
        failNextCreate(error) {
            nextCreateError = error;
        },
        failNextGc(error) {
            nextGcError = error;
        },
        async create(input): Promise<IWorkspace> {
            // a real provider never answers in the same tick
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            provider.created.push(input);
            if (provider.gate) await provider.gate;
            if (nextCreateError) {
                const error = nextCreateError;
                nextCreateError = undefined;
                throw error;
            }
            const now = clock.now();
            const workspace = createScriptedWorkspace(options.onExec, {
                runId: input.runId,
                provider: 'fake',
                repo: input.repo,
                ref: input.ref,
                commit: input.repo ? FAKE_COMMIT : undefined,
                ...(input.repo !== undefined && { defaultBranch: 'main' }),
                ...((input.image ?? options.image) !== undefined && { image: input.image ?? options.image }),
                createdAt: now,
                expiresAt: new Date(now.getTime() + (input.limits?.maxLifetimeMs ?? DEFAULT_LIMITS.maxLifetimeMs)),
            }, randomUUID());
            track(workspace);
            provider.deployments.set(workspace.id, input.deployment ?? DEFAULT_DEPLOYMENT);
            return workspace;
        },
        async find(runId, options) {
            await new Promise<void>((resolve) => { setImmediate(resolve); });
            provider.findCalls.push({ runId, options });
            if (provider.findGate) await provider.findGate;
            if (nextFindError) {
                const error = nextFindError;
                nextFindError = undefined;
                throw error;
            }
            const deployment = options?.deployment ?? DEFAULT_DEPLOYMENT;
            const now = clock.now().getTime();
            return provider.workspaces.values().toArray().filter((workspace) => !workspace.disposed &&
                workspace.info.runId === runId &&
                workspace.info.expiresAt.getTime() > now &&
                provider.deployments.get(workspace.id) === deployment);
        },
        stop(id, stopOptions = {}) {
            const workspace = provider.workspaces.get(id)!;
            workspace.disposed = true;
            if (stopOptions.removed) return;
            const restarted = createScriptedWorkspace(options.onExec, workspace.info, id);
            for (const [path, content] of workspace.files) restarted.files.set(path, content);
            track(restarted);
        },
        async collectGarbage(options) {
            provider.gcCalls++;
            provider.gcOptions.push(options);
            if (nextGcError) {
                const error = nextGcError;
                nextGcError = undefined;
                throw error;
            }
            return 0;
        },
    };
    return provider;
}

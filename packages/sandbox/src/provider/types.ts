/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IWorkspace } from '../workspace/types.ts';

export type SandboxLimits = {
    /** Kubernetes quantity, e.g. `'1'`, `'500m'`. */
    cpu?: string;
    /** Bytes as a Kubernetes quantity, e.g. `'2Gi'`. */
    memory?: string;
    /** Disk of `/workspace`, e.g. `'4Gi'`. */
    storage?: string;
    pids?: number;
    /**
     * Hard cap of a workspace's lifetime (its `expiresAt`), from its creation,
     * never renewed. Nothing kills a workspace earlier while its run lives;
     * garbage collection removes it once expired or its run settled.
     */
    maxLifetimeMs?: number;
};

export type WorkspaceCreateOptions = {
    runId: string;
    /** A normalized repository URL (`normalizeRepo`); without it the workspace is only `git init`-ed. */
    repo?: string;
    ref?: string;
    /** The image of a container or pod workspace; default the provider's. */
    image?: string;
    /**
     * True when `image` is what a run asked for (`create_workspace({ image })`):
     * a container or pod provider pulls it when missing, whatever its pull
     * policy. The provider's own image and the operator's (the manager's
     * `image`) follow the policy.
     */
    imageRequested?: boolean;
    env?: Record<string, string>;
    limits?: SandboxLimits;
    /** The deployment the workspace belongs to; default `DEFAULT_DEPLOYMENT`. */
    deployment?: string;
    signal?: AbortSignal;
};

export type WorkspaceFindOptions = {
    /** Only workspaces of this deployment; default `DEFAULT_DEPLOYMENT`. */
    deployment?: string;
    signal?: AbortSignal;
};

export type GarbageCollectOptions = {
    /** Only workspaces of this deployment; default `DEFAULT_DEPLOYMENT`. */
    deployment?: string;
    /**
     * True when the run settled or no longer exists: its workspaces go too,
     * expired or not. A rejection keeps them and counts as a failure.
     */
    isSettled?(runId: string): Promise<boolean>;
};

export interface ISandboxProvider {
    readonly name: string;
    /**
     * A ready workspace (id `randomUUID()`), checked out when `repo` is given
     * (via `prepareWorkspace`, then `info.commit = commit`).
     */
    create(options: WorkspaceCreateOptions): Promise<IWorkspace>;
    /**
     * Every live, unexpired workspace of the run in the deployment this
     * provider can reach (labels, folders), reconnected: the instance this
     * process holds, else a new one rebuilt from what lives with the
     * workspace. Never creates; a stopped Docker container is started again.
     */
    find(runId: string, options?: WorkspaceFindOptions): Promise<IWorkspace[]>;
    /**
     * Deletes this provider's workspaces of the deployment past their expiry
     * and, with `isSettled`, those whose run settled; returns how many. One
     * that cannot be removed never keeps the others: the pass goes on and
     * rejects with one SandboxError at the end.
     */
    collectGarbage(options?: GarbageCollectOptions): Promise<number>;
}

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import type { Engine, IClock } from '@chamvi/core';
import type { IGitCredentials } from '../credentials/types.ts';
import type { ISandboxProvider, SandboxLimits } from '../provider/types.ts';
import type { IWorkspace } from '../workspace/types.ts';

export type WorkspaceManagerOptions = {
    provider: ISandboxProvider;
    /** Passed to every `create`. */
    image?: string;
    /** Passed to every `create`. */
    env?: Record<string, string>;
    /** Passed to every `create`. */
    limits?: SandboxLimits;
    /** Accept `file:///absolute/path` repositories (local development and tests). Default false. */
    allowFileRepos?: boolean;
    /** Narrows the accepted repositories further; gets the normalized URL. */
    allowRepo?: (url: string) => boolean;
    /**
     * The images `create_workspace` may ask for; gets the reference as
     * requested. Without it, and on the local provider (it runs no images),
     * `create_workspace` has no `image` parameter and a requested image is a
     * `ValidationError`. Never asked for the manager's or the provider's own
     * image.
     */
    allowImage?: (image: string) => boolean;
    /** Workspaces one run may hold at once. Default MAX_WORKSPACES_PER_RUN (3). */
    maxWorkspacesPerRun?: number;
    /** Minimum interval between the garbage collections `acquire` starts. Default GC_INTERVAL_MS; 0 disables them. */
    gcIntervalMs?: number;
    /**
     * The deployment the workspaces belong to (a label value): `find` and the
     * garbage collection only see their own. Default `DEFAULT_DEPLOYMENT`.
     */
    deployment?: string;
    /**
     * True when a run settled or no longer exists; the garbage collection then
     * disposes its workspaces, also ones another process created. Without
     * it only expired workspaces are collected.
     */
    isSettled?: (runId: string) => Promise<boolean>;
    /**
     * Git credentials for private repositories and pushes: the first source
     * that answers wins, none answering is anonymous. They reach git through
     * a credential helper and a 0600 file in the workspace's HOME (installed
     * before the checkout, refreshed before execs), so plain git in `bash`
     * fetches and pushes; code in the workspace can read them, so the
     * token's grants and the forge's branch protection bound what it can do.
     */
    credentials?: IGitCredentials | IGitCredentials[];
    /** A shallow checkout of this many commits for huge repositories; default the full history. */
    depth?: number;
    /** The commit identity, set as `GIT_AUTHOR_*` and `GIT_COMMITTER_*` in every workspace's environment. */
    author?: GitAuthor;
    clock?: IClock;
    /** Background failures (disposal, garbage collection, credential refreshes). Default console.error. */
    onError?: (error: unknown) => void;
};

export type GitAuthor = {
    name: string;
    email: string;
};

export type AcquireInput = {
    /** `owner/name`, an https URL, or `file:///absolute/path` with `allowFileRepos`. */
    repo?: string;
    ref?: string;
    /**
     * An image reference (`assertImage`), only with `allowImage` and not on
     * the local provider, checked by `allowImage`; default the manager's,
     * else the provider's.
     */
    image?: string;
    signal?: AbortSignal;
};

export type CloseOptions = {
    /** How long close() waits for disposals and creates in flight. Default CLOSE_TIMEOUT_MS (30 s). */
    timeoutMs?: number;
    /**
     * Also dispose the workspaces of live runs (default false: they stay for
     * their runs to find again). For a store nothing resumes from, a MemoryStore.
     */
    dispose?: boolean;
};

export type AcquireResult = {
    workspace: IWorkspace;
    /** True when the run already held (or was creating) the workspace of this repository. */
    reused: boolean;
};

/**
 * Run-scoped workspaces: one per run and repository (or none), created
 * through the provider and disposed when the run settles (`attach`).
 */
export interface IWorkspaceManager {
    /**
     * The run's workspace of `repo` (none: the repo-less one): held, else
     * found through `provider.find` (adopted, `reused`), else created when
     * missing, expired or gone (`IWorkspace.disposed`). Concurrent calls share one create. ValidationError for a
     * repository, ref or image the rules refuse; SandboxError for another ref
     * or image of a held repository, a reached per-run cap or a failed create.
     */
    acquire(runId: string, input: AcquireInput): Promise<AcquireResult>;
    /**
     * The run's workspace by id, or its only live one when id is omitted
     * (expired and gone ones are disposed first). A run that holds none that
     * fits is looked up through `provider.find` (one lookup per run at a
     * time) and the found ones adopted. SandboxError: unknown, expired or gone
     * (disposed then), none, a failed lookup; ValidationError: several and no id.
     */
    get(runId: string, workspaceId?: string): Promise<IWorkspace>;
    /**
     * Disposes one workspace (SandboxError /not found/ for an id the run does
     * not hold or find, like get), or all of the run (never rejects for none):
     * the held ones and every one `provider.find` reports for the run; this
     * aborts the run's creates and lookups in flight and waits for the creates.
     */
    release(runId: string, workspaceId?: string): Promise<void>;
    /**
     * Disposes a run's workspaces on completed | failed | cancelled (`release`,
     * so also those other processes created). With `isSettled`, a run this
     * process neither holds nor looks up is not looked up (no `provider.find`
     * per settled run): it starts a garbage collection instead (at most one
     * per `gcIntervalMs`), which removes what other processes left for it.
     * Returns the unsubscribe; after close() it subscribes nothing.
     */
    attach(engine: Pick<Engine, 'on'>): () => void;
    /** `create_workspace` and `dispose_workspace`. */
    tools(): ToolSet;
    /**
     * Disposes the manager's expired workspaces and, with `isSettled`, the
     * ones of settled runs, then runs the provider's collection (deployment
     * and `isSettled` passed on); returns how many went.
     */
    collectGarbage(): Promise<number>;
    /**
     * Unsubscribes every attach, aborts the creates in flight (disposing what
     * they made) and forgets the held workspaces without disposing them: they
     * belong to live runs, which find them again after a restart (with
     * `dispose: true` it disposes them too). Waits for
     * the creates, for disposals started earlier and for the creates in
     * flight of runs released before (call after engine.drain()); afterwards
     * acquire, get and lookups reject and attach subscribes nothing. Resolves
     * after `timeoutMs` at the latest, reporting what is still being disposed
     * to `onError`.
     */
    close(options?: CloseOptions): Promise<void>;
}

export type WorkspaceToolResult = {
    workspace: string;
    root: '/workspace';
    repo: string | null;
    ref: string | null;
    commit: string | null;
    /** The remote's default branch, fetched as `origin/<name>` (the base to merge or rebase onto). */
    defaultBranch: string | null;
    /** The image of a container or pod workspace; null on local. */
    image: string | null;
    expiresAt: string;
    reused: boolean;
};

export type DisposeWorkspaceResult = {
    workspace: string;
    disposed: true;
};

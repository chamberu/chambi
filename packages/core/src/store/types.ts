/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { AgentRevision } from '../agent/types.ts';
import type { Artifact } from '../artifact/types.ts';
import type { IConversationStore } from '../conversation/types.ts';
import type {
    Checkpoint,
    Run,
    RunStatusLiteral,
    Step,
} from '../run/types.ts';

/**
 * Expiry rule shared by every TTL (run claims, idempotency keys, locks):
 * a lease/key created at time T with ttlMs expires AT T + ttlMs, i.e. at exactly
 * `expiresAt` it already counts as expired and can be taken over.
 *
 * Implementations must return copies: mutating a value passed in after the call,
 * or a value returned from the store, must never change what the store holds.
 */
export interface IRunStore {
    /**
     * Atomic insert-if-absent: resolves false and keeps the stored run when a run
     * with that id exists (two dispatches may create the run an idempotency key names).
     */
    createRun(run: Run): Promise<boolean>;
    getRun(id: string): Promise<Run | undefined>;
    /**
     * Throws InvalidRunStateError when `expectStatus` does not match the current
     * status, or when `expectOwner` is given and the run's claim is absent or held
     * by another owner (expiry is not checked: a lease is lost once taken over).
     */
    updateRun(id: string, patch: Partial<Run>, opts?: { expectStatus?: RunStatusLiteral[]; expectOwner?: string }): Promise<Run>;
    /**
     * Ordered by createdAt, ties broken by id, both ascending (`order` `asc`,
     * the default) or both descending (`desc`). `total` ignores limit/offset.
     * Without `limit`, every matching run (from `offset`) is returned: there is
     * no default page size.
     */
    listRuns(q: {
        agent?: string;
        status?: RunStatusLiteral[];
        concurrencyKey?: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
    }): Promise<{ data: Run[]; total: number }>;
    /** Atomic: only succeeds when unleased or the lease expired. */
    claimRun(id: string, owner: string, ttlMs: number): Promise<boolean>;
    /** Extends the lease; only succeeds for the current, unexpired owner. */
    renewClaim(id: string, owner: string, ttlMs: number): Promise<boolean>;
}

export interface IStepStore {
    /** The parent run must already exist. */
    appendStep(step: Step): Promise<void>;
    listSteps(runId: string): Promise<Step[]>;
}

export interface ICheckpointStore {
    /**
     * Keeps the highest stepIndex; an equal stepIndex replaces (approval responses are appended that way).
     * The parent run must already exist.
     */
    saveCheckpoint(cp: Checkpoint): Promise<void>;
    latestCheckpoint(runId: string): Promise<Checkpoint | undefined>;
}

export interface IIdempotencyStore {
    /** Atomic: the first caller per (scope, key) creates; others get the winner's runId. */
    claimKey(scope: string, key: string, runId: string, ttlMs: number): Promise<{ created: boolean; runId: string }>;
}

export interface ILockStore {
    acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
    release(key: string, owner: string): Promise<void>;
}

export interface IEffectStore {
    getEffect(key: string): Promise<{ result: unknown } | undefined>;
    putEffect(key: string, result: unknown): Promise<void>;
}

export interface IStateStore {
    kvGet(agent: string, key: string): Promise<unknown>;
    /** `undefined` removes the key. */
    kvSet(agent: string, key: string, value: unknown): Promise<void>;
    /**
     * One agent's entries ordered by key in code-point order (`COLLATE "C"`),
     * values copied out; every entry (from `offset`) without `limit`.
     */
    kvList(agent: string, q?: { limit?: number; offset?: number }): Promise<Array<{ key: string; value: unknown }>>;
    /** `where` matches by top-level equality. */
    docList(
        agent: string,
        coll: string,
        q?: { where?: Record<string, unknown>; limit?: number },
    ): Promise<Array<{ id: string; doc: unknown }>>;
    docUpsert(agent: string, coll: string, id: string, doc: unknown): Promise<void>;
    docDelete(agent: string, coll: string, id: string): Promise<void>;
}

/** Files of runs (attachments and tool outputs): metadata and bytes, both copied in and out. */
export interface IArtifactStore {
    /**
     * Atomic insert-if-absent: resolves false and keeps the stored artifact
     * (metadata and bytes) when an artifact with that id exists.
     */
    putArtifact(artifact: Artifact, data: Uint8Array): Promise<boolean>;
    /** Metadata only. */
    getArtifact(id: string): Promise<Artifact | undefined>;
    /** The bytes, as a plain Uint8Array (no Buffer or other subclass). */
    readArtifact(id: string): Promise<Uint8Array | undefined>;
    /** Metadata of a run's artifacts, ordered by createdAt ascending, ties broken by id ascending. */
    listArtifacts(runId: string): Promise<Artifact[]>;
}

/** One revision marker per folder agent, keyed by agent name, copied in and out. */
export interface IAgentRevisionStore {
    getAgentRevision(agent: string): Promise<AgentRevision | undefined>;
    /** Upsert: replaces the hash and `changedAt` of an existing marker. */
    setAgentRevision(revision: AgentRevision): Promise<void>;
    /** Deleting a missing marker is a no-op. */
    deleteAgentRevision(agent: string): Promise<void>;
    /** Every marker, ordered by agent in code-point order (`COLLATE "C"`). */
    listAgentRevisions(): Promise<AgentRevision[]>;
}

/** Capabilities may be supplied by independent storage implementations. */
export type Stores = {
    runs: IRunStore;
    steps: IStepStore;
    checkpoints: ICheckpointStore;
    idempotency: IIdempotencyStore;
    locks: ILockStore;
    effects: IEffectStore;
    state: IStateStore;
    artifacts: IArtifactStore;
    agentRevisions: IAgentRevisionStore;
    conversations?: IConversationStore;
};

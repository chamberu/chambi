/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { AgentRevision } from '../agent/types.ts';
import type { Artifact } from '../artifact/types.ts';
import type { IConversationRepository } from '../conversation/types.ts';
import type {
    Checkpoint,
    Run,
    RunStatusLiteral,
    Step,
} from '../run/types.ts';

export type RunFindOptions = {
    agent?: string;
    status?: RunStatusLiteral[];
    concurrencyKey?: string;
    limit?: number;
    offset?: number;
    order?: 'asc' | 'desc';
};

export type StateFindOptions = { limit?: number; offset?: number };

export type StateDocumentFindOptions = { where?: Record<string, unknown>; limit?: number };

/**
 * Query contract: findOne returns undefined when absent; find returns an empty
 * result when nothing matches. Their OrFail counterparts throw on absence or an
 * empty selected page, even if records exist outside that page. Falsy values
 * (including null) count as present. They preserve each query's ordering and copies.
 *
 * Expiry rule shared by every TTL (run claims, idempotency keys, locks):
 * a lease/key created at time T with ttlMs expires AT T + ttlMs, i.e. at exactly
 * `expiresAt` it already counts as expired and can be taken over.
 *
 * Implementations must return copies: mutating a value passed in after the call,
 * or a value returned from a repository, must never change what it holds.
 */
export interface IRunRepository {
    /**
     * Atomic insert-if-absent: resolves false and keeps the stored run when a run
     * with that id exists (two dispatches may create the run an idempotency key names).
     */
    insert(run: Run): Promise<boolean>;
    findOne(id: string): Promise<Run | undefined>;
    findOneOrFail(id: string): Promise<Run>;
    /**
     * Throws InvalidRunStateError when `expectStatus` does not match the current
     * status, or when `expectOwner` is given and the run's claim is absent or held
     * by another owner (expiry is not checked: a lease is lost once taken over).
     */
    update(id: string, patch: Partial<Run>, opts?: { expectStatus?: RunStatusLiteral[]; expectOwner?: string }): Promise<Run>;
    /**
     * Ordered by createdAt, ties broken by id, both ascending (`order` `asc`,
     * the default) or both descending (`desc`). `total` ignores limit/offset.
     * Without `limit`, every matching run (from `offset`) is returned: there is
     * no default page size.
     */
    find(q: RunFindOptions): Promise<{ data: Run[]; total: number }>;
    findOrFail(q: RunFindOptions): Promise<{ data: Run[]; total: number }>;
    /** Atomic: only succeeds when unleased or the lease expired. */
    claim(id: string, owner: string, ttlMs: number): Promise<boolean>;
    /** Extends the lease; only succeeds for the current, unexpired owner. */
    renewClaim(id: string, owner: string, ttlMs: number): Promise<boolean>;
}

export interface IStepRepository {
    /** The parent run must already exist. */
    insert(step: Step): Promise<void>;
    find(runId: string): Promise<Step[]>;
    findOrFail(runId: string): Promise<Step[]>;
}

export interface ICheckpointRepository {
    /**
     * Keeps the highest stepIndex; an equal stepIndex replaces (approval responses are appended that way).
     * The parent run must already exist.
     */
    save(cp: Checkpoint): Promise<void>;
    findOne(runId: string): Promise<Checkpoint | undefined>;
    findOneOrFail(runId: string): Promise<Checkpoint>;
}

export interface IIdempotencyRepository {
    /** Atomic: the first caller per (scope, key) creates; others get the winner's runId. */
    claim(scope: string, key: string, runId: string, ttlMs: number): Promise<{ created: boolean; runId: string }>;
}

export interface ILockRepository {
    acquire(key: string, owner: string, ttlMs: number): Promise<boolean>;
    release(key: string, owner: string): Promise<void>;
}

export interface IEffectRepository {
    findOne(key: string): Promise<{ result: unknown } | undefined>;
    findOneOrFail(key: string): Promise<{ result: unknown }>;
    save(key: string, result: unknown): Promise<void>;
}

export interface IStateRepository {
    findOne(agent: string, key: string): Promise<unknown>;
    findOneOrFail(agent: string, key: string): Promise<unknown>;
    /** `undefined` removes the key. */
    set(agent: string, key: string, value: unknown): Promise<void>;
    /**
     * One agent's entries ordered by key in code-point order (`COLLATE "C"`),
     * values copied out; every entry (from `offset`) without `limit`.
     */
    find(agent: string, q?: StateFindOptions): Promise<Array<{ key: string; value: unknown }>>;
    findOrFail(agent: string, q?: StateFindOptions): Promise<Array<{ key: string; value: unknown }>>;
    /** `where` matches by top-level equality. */
    findDocuments(
        agent: string,
        coll: string,
        q?: StateDocumentFindOptions,
    ): Promise<Array<{ id: string; doc: unknown }>>;
    findDocumentsOrFail(
        agent: string,
        coll: string,
        q?: StateDocumentFindOptions,
    ): Promise<Array<{ id: string; doc: unknown }>>;
    upsertDocument(agent: string, coll: string, id: string, doc: unknown): Promise<void>;
    deleteDocument(agent: string, coll: string, id: string): Promise<void>;
}

/** Files of runs (attachments and tool outputs): metadata and bytes, both copied in and out. */
export interface IArtifactRepository {
    /**
     * Atomic insert-if-absent: resolves false and keeps the stored artifact
     * (metadata and bytes) when an artifact with that id exists.
     */
    insert(artifact: Artifact, data: Uint8Array): Promise<boolean>;
    /** Metadata only. */
    findOne(id: string): Promise<Artifact | undefined>;
    findOneOrFail(id: string): Promise<Artifact>;
    /** The bytes, as a plain Uint8Array (no Buffer or other subclass). */
    read(id: string): Promise<Uint8Array | undefined>;
    /** Metadata of a run's artifacts, ordered by createdAt ascending, ties broken by id ascending. */
    find(runId: string): Promise<Artifact[]>;
    findOrFail(runId: string): Promise<Artifact[]>;
}

/** One revision marker per folder agent, keyed by agent name, copied in and out. */
export interface IAgentRevisionRepository {
    findOne(agent: string): Promise<AgentRevision | undefined>;
    findOneOrFail(agent: string): Promise<AgentRevision>;
    /** Upsert: replaces the hash and `changedAt` of an existing marker. */
    save(revision: AgentRevision): Promise<void>;
    /** Deleting a missing marker is a no-op. */
    delete(agent: string): Promise<void>;
    /** Every marker, ordered by agent in code-point order (`COLLATE "C"`). */
    find(): Promise<AgentRevision[]>;
    findOrFail(): Promise<AgentRevision[]>;
}

/** Capabilities may be supplied by independent storage implementations. */
export type Repositories = {
    runs: IRunRepository;
    steps: IStepRepository;
    checkpoints: ICheckpointRepository;
    idempotency: IIdempotencyRepository;
    locks: ILockRepository;
    effects: IEffectRepository;
    state: IStateRepository;
    artifacts: IArtifactRepository;
    agentRevisions: IAgentRevisionRepository;
    conversations?: IConversationRepository;
};

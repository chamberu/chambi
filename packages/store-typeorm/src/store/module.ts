/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    InvalidRunStateError,
    RunNotFoundError,
    systemClock,
} from '@chamvi/core';
import type {
    AgentRevision,
    Artifact,
    Checkpoint,
    IClock,
    IStore,
    Run,
    RunStatusLiteral,
    Step,
} from '@chamvi/core';
import {
    In,
    IsNull,
    JsonContains,
    LessThanOrEqual,
    MoreThan,
} from 'typeorm';
import type {
    DataSource,
    FindOptionsWhere,
    Repository,
} from 'typeorm';
import {
    AgentRevisionEntity,
    ArtifactEntity,
    CheckpointEntity,
    DocEntity,
    EffectEntity,
    IdempotencyKeyEntity,
    KvEntity,
    LockEntity,
    RunEntity,
    StepEntity,
} from '../entities/index.ts';
import {
    asValues,
    toAgentRevision,
    toArtifact,
    toArtifactValues,
    toCheckpoint,
    toCheckpointValues,
    toEntity,
    toRun,
    toRunValues,
    toStep,
    toStepValues,
} from './helpers.ts';
import type { PurgeResult, TypeormStoreOptions } from './types.ts';

/**
 * TypeORM store (PostgreSQL). Every method goes through the entities'
 * repositories and query builders, every atomic operation is a single
 * statement, with time taken from the clock.
 */
export class TypeormStore implements IStore {
    protected dataSource: DataSource;

    protected clock: IClock;

    constructor(opts: TypeormStoreOptions) {
        this.dataSource = opts.dataSource;
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): Date {
        return this.clock.now();
    }

    protected get runs(): Repository<RunEntity> {
        return this.dataSource.getRepository(RunEntity);
    }

    protected get steps(): Repository<StepEntity> {
        return this.dataSource.getRepository(StepEntity);
    }

    protected get checkpoints(): Repository<CheckpointEntity> {
        return this.dataSource.getRepository(CheckpointEntity);
    }

    protected get idempotencyKeys(): Repository<IdempotencyKeyEntity> {
        return this.dataSource.getRepository(IdempotencyKeyEntity);
    }

    protected get locks(): Repository<LockEntity> {
        return this.dataSource.getRepository(LockEntity);
    }

    protected get effects(): Repository<EffectEntity> {
        return this.dataSource.getRepository(EffectEntity);
    }

    protected get kv(): Repository<KvEntity> {
        return this.dataSource.getRepository(KvEntity);
    }

    protected get docs(): Repository<DocEntity> {
        return this.dataSource.getRepository(DocEntity);
    }

    protected get artifacts(): Repository<ArtifactEntity> {
        return this.dataSource.getRepository(ArtifactEntity);
    }

    protected get agentRevisions(): Repository<AgentRevisionEntity> {
        return this.dataSource.getRepository(AgentRevisionEntity);
    }

    // IRunStore

    async createRun(run: Run): Promise<boolean> {
        const result = await this.runs.createQueryBuilder()
            .insert()
            .values({ id: run.id, ...toRunValues(run) })
            .orIgnore()
            .returning(['id'])
            .updateEntity(false)
            .execute();
        return result.raw.length === 1;
    }

    async getRun(id: string): Promise<Run | undefined> {
        const entity = await this.runs.findOneBy({ id });
        return entity ? toRun(entity) : undefined;
    }

    async updateRun(
        id: string,
        patch: Partial<Run>,
        opts: { expectStatus?: RunStatusLiteral[]; expectOwner?: string } = {},
    ): Promise<Run> {
        const where: FindOptionsWhere<RunEntity> = { id };
        if (opts.expectStatus) {
            where.status = In(opts.expectStatus);
        }
        if (opts.expectOwner !== undefined) {
            where.claimOwner = opts.expectOwner;
        }

        const result = await this.runs.createQueryBuilder()
            .update()
            .set(toRunValues({ ...patch, updatedAt: patch.updatedAt ?? this.now() }))
            .where(where)
            .returning('*')
            .updateEntity(false)
            .execute();
        if (result.raw.length === 1) {
            return toRun(toEntity(this.dataSource, RunEntity, result.raw[0]));
        }

        const current = await this.runs.findOneBy({ id });
        if (!current) {
            throw new RunNotFoundError(id);
        }

        if (opts.expectStatus && !opts.expectStatus.includes(current.status)) {
            throw new InvalidRunStateError(
                `Run "${id}" is "${current.status}", expected one of: ${opts.expectStatus.join(', ')}.`,
            );
        }
        if (opts.expectOwner !== undefined && current.claimOwner !== opts.expectOwner) {
            throw new InvalidRunStateError(
                `Run "${id}" is not claimed by "${opts.expectOwner}" (claim: ${current.claimOwner ?? 'none'}).`,
            );
        }

        throw new InvalidRunStateError(`Run "${id}" changed concurrently.`);
    }

    async listRuns(q: {
        agent?: string;
        status?: RunStatusLiteral[];
        concurrencyKey?: string;
        limit?: number;
        offset?: number;
        order?: 'asc' | 'desc';
    }): Promise<{ data: Run[]; total: number }> {
        const where: FindOptionsWhere<RunEntity> = {};
        if (q.agent !== undefined) {
            where.agent = q.agent;
        }
        if (q.status !== undefined) {
            where.status = In(q.status);
        }
        if (q.concurrencyKey !== undefined) {
            where.concurrencyKey = q.concurrencyKey;
        }

        if (q.limit === 0) {
            // take: 0 means no limit to TypeORM
            return { data: [], total: await this.runs.countBy(where) };
        }

        const direction = q.order === 'desc' ? 'DESC' : 'ASC';
        const [entities, total] = await this.runs.findAndCount({
            where,
            order: { createdAt: direction, id: direction },
            skip: q.offset,
            take: q.limit,
        });
        return { data: entities.map((entity) => toRun(entity)), total };
    }

    async claimRun(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = this.now();
        const result = await this.runs.createQueryBuilder()
            .update()
            .set({ claimOwner: owner, claimExpiresAt: new Date(now.getTime() + ttlMs) })
            .where([
                { id, claimOwner: IsNull() },
                { id, claimExpiresAt: LessThanOrEqual(now) },
            ])
            .execute();
        return result.affected === 1;
    }

    async renewClaim(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = this.now();
        const result = await this.runs.createQueryBuilder()
            .update()
            .set({ claimExpiresAt: new Date(now.getTime() + ttlMs) })
            .where({
                id,
                claimOwner: owner,
                claimExpiresAt: MoreThan(now),
            })
            .execute();
        return result.affected === 1;
    }

    // IStepStore

    async appendStep(step: Step): Promise<void> {
        await this.steps.createQueryBuilder()
            .insert()
            .values(toStepValues(step))
            .updateEntity(false)
            .execute();
    }

    async listSteps(runId: string): Promise<Step[]> {
        const entities = await this.steps.find({
            where: { runId },
            order: { index: 'ASC', seq: 'ASC' },
        });
        return entities.map((entity) => toStep(entity));
    }

    // ICheckpointStore

    async saveCheckpoint(cp: Checkpoint): Promise<void> {
        await this.checkpoints.createQueryBuilder()
            .insert()
            .values(toCheckpointValues(cp))
            .orUpdate(
                ['step_index', 'messages', 'finish_reason', 'created_at', 'conversation_scope_id', 'conversation_generation'],
                ['run_id'],
                { overwriteCondition: { where: { stepIndex: LessThanOrEqual(cp.stepIndex) } } },
            )
            .updateEntity(false)
            .execute();
    }

    async latestCheckpoint(runId: string): Promise<Checkpoint | undefined> {
        const entity = await this.checkpoints.findOneBy({ runId });
        return entity ? toCheckpoint(entity) : undefined;
    }

    // IIdempotencyStore

    async claimKey(scope: string, key: string, runId: string, ttlMs: number): Promise<{ created: boolean; runId: string }> {
        // A miss on the read means a concurrent purge removed the expired
        // key between the two statements; the next attempt then inserts.
        for (;;) {
            const now = this.now();
            const result = await this.idempotencyKeys.createQueryBuilder()
                .insert()
                .values({
                    scope,
                    key,
                    runId,
                    expiresAt: new Date(now.getTime() + ttlMs),
                })
                .orUpdate(
                    ['run_id', 'expires_at'],
                    ['scope', 'key'],
                    { overwriteCondition: { where: { expiresAt: LessThanOrEqual(now) } } },
                )
                .returning(['runId'])
                .updateEntity(false)
                .execute();
            if (result.raw.length > 0) {
                return { created: true, runId };
            }

            const existing = await this.idempotencyKeys.findOneBy({ scope, key });
            if (existing) {
                return { created: false, runId: existing.runId };
            }
        }
    }

    // ILockStore

    async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = this.now();
        const result = await this.locks.createQueryBuilder()
            .insert()
            .values({
                key,
                owner,
                expiresAt: new Date(now.getTime() + ttlMs),
            })
            .orUpdate(
                ['owner', 'expires_at'],
                ['key'],
                { overwriteCondition: { where: { expiresAt: LessThanOrEqual(now) } } },
            )
            .returning(['key'])
            .updateEntity(false)
            .execute();
        return result.raw.length === 1;
    }

    async release(key: string, owner: string): Promise<void> {
        await this.locks.delete({ key, owner });
    }

    // IEffectStore

    async getEffect(key: string): Promise<{ result: unknown } | undefined> {
        const entity = await this.effects.findOneBy({ key });
        return entity ? { result: entity.result } : undefined;
    }

    async putEffect(key: string, result: unknown): Promise<void> {
        await this.effects.upsert(asValues<EffectEntity>({ key, result: result ?? null }), ['key']);
    }

    // IStateStore

    async kvGet(agent: string, key: string): Promise<unknown> {
        const entity = await this.kv.findOneBy({ agent, key });
        return entity ? entity.value : undefined;
    }

    async kvSet(agent: string, key: string, value: unknown): Promise<void> {
        if (value === undefined) {
            await this.kv.delete({ agent, key });
            return;
        }

        await this.kv.upsert(asValues<KvEntity>({
            agent,
            key,
            value,
        }), ['agent', 'key']);
    }

    async kvList(agent: string, q: { limit?: number; offset?: number } = {}): Promise<Array<{ key: string; value: unknown }>> {
        if (q.limit === 0) {
            // take: 0 means no limit to TypeORM
            return [];
        }

        const entities = await this.kv.find({
            where: { agent },
            order: { key: 'ASC' },
            skip: q.offset,
            take: q.limit,
        });
        return entities.map((entity) => ({ key: entity.key, value: entity.value }));
    }

    async docList(
        agent: string,
        coll: string,
        q: { where?: Record<string, unknown>; limit?: number } = {},
    ): Promise<Array<{ id: string; doc: unknown }>> {
        if (q.limit === 0) {
            // limit(0) means no limit to TypeORM
            return [];
        }

        const query = this.docs.createQueryBuilder('d')
            .where({ agent, collection: coll })
            .orderBy('d.id', 'ASC');
        if (q.where && Object.keys(q.where).length > 0) {
            // Containment with the defined values (an empty object still
            // restricts to object documents); a key whose value is undefined
            // matches documents lacking it, as in MemoryStore. The doc
            // column's transformer sanitizes the containment value.
            const defined: Record<string, unknown> = {};
            let i = 0;
            for (const [key, value] of Object.entries(q.where)) {
                if (value === undefined) {
                    // raw: TypeORM has no operator for jsonb key existence (?)
                    query.andWhere(`NOT jsonb_exists(d.doc, :absent${i})`, { [`absent${i}`]: key });
                    i++;
                } else {
                    defined[key] = value;
                }
            }
            query.andWhere({ doc: JsonContains(defined) });
        }
        if (q.limit !== undefined) {
            query.limit(q.limit);
        }

        const entities = await query.getMany();
        return entities.map((entity) => ({ id: entity.id, doc: entity.doc }));
    }

    async docUpsert(agent: string, coll: string, id: string, doc: unknown): Promise<void> {
        await this.docs.upsert(asValues<DocEntity>({
            agent,
            collection: coll,
            id,
            doc: doc ?? null,
        }), ['agent', 'collection', 'id']);
    }

    async docDelete(agent: string, coll: string, id: string): Promise<void> {
        await this.docs.delete({
            agent,
            collection: coll,
            id,
        });
    }

    // IArtifactStore

    async putArtifact(artifact: Artifact, data: Uint8Array): Promise<boolean> {
        const result = await this.artifacts.createQueryBuilder()
            .insert()
            .values(toArtifactValues(artifact, data))
            .orIgnore()
            .returning(['id'])
            .updateEntity(false)
            .execute();
        return result.raw.length === 1;
    }

    async getArtifact(id: string): Promise<Artifact | undefined> {
        // the data column is select: false, so the bytes stay in the database
        const entity = await this.artifacts.findOneBy({ id });
        return entity ? toArtifact(entity) : undefined;
    }

    async readArtifact(id: string): Promise<Uint8Array | undefined> {
        const entity = await this.artifacts.findOne({
            select: { id: true, data: true },
            where: { id },
        });
        // a copy into a plain Uint8Array: a Buffer would leak its toJSON
        return entity ? new Uint8Array(entity.data) : undefined;
    }

    async listArtifacts(runId: string): Promise<Artifact[]> {
        const entities = await this.artifacts.find({
            where: { runId },
            order: { createdAt: 'ASC', id: 'ASC' },
        });
        return entities.map((entity) => toArtifact(entity));
    }

    // IAgentRevisionStore

    async getAgentRevision(agent: string): Promise<AgentRevision | undefined> {
        const entity = await this.agentRevisions.findOneBy({ agent });
        return entity ? toAgentRevision(entity) : undefined;
    }

    async setAgentRevision(revision: AgentRevision): Promise<void> {
        await this.agentRevisions.upsert(asValues<AgentRevisionEntity>({
            agent: revision.agent,
            hash: revision.hash,
            changedAt: revision.changedAt,
        }), ['agent']);
    }

    async deleteAgentRevision(agent: string): Promise<void> {
        await this.agentRevisions.delete({ agent });
    }

    async listAgentRevisions(): Promise<AgentRevision[]> {
        const entities = await this.agentRevisions.find({ order: { agent: 'ASC' } });
        return entities.map((entity) => toAgentRevision(entity));
    }

    // Maintenance

    /**
     * Delete idempotency keys and locks expired at `now` (default: the clock's
     * time). Effects have no expiry and are never purged.
     */
    async purgeExpired(now: Date = this.now()): Promise<PurgeResult> {
        const idempotencyKeys = await this.idempotencyKeys.delete({ expiresAt: LessThanOrEqual(now) });
        const locks = await this.locks.delete({ expiresAt: LessThanOrEqual(now) });

        return {
            idempotencyKeys: idempotencyKeys.affected ?? 0,
            locks: locks.affected ?? 0,
        };
    }
}

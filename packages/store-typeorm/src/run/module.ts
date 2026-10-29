/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidRunStateError, RunNotFoundError, systemClock } from '@chamvi/core';
import type {
    IClock,
    IRunStore,
    Run,
    RunStatusLiteral,
} from '@chamvi/core';
import {
    In,
    IsNull,
    LessThanOrEqual,
    MoreThan,
} from 'typeorm';
import type { DataSource, FindOptionsWhere, Repository } from 'typeorm';
import { RunEntity } from '../entities/index.ts';
import { toEntity, toRun, toRunValues } from '../store/helpers.ts';
import type { TypeormStoresOptions } from '../store/types.ts';

export class TypeormRunStore implements IRunStore {
    protected dataSource: DataSource;

    protected clock: IClock;

    constructor(opts: TypeormStoresOptions) {
        this.dataSource = opts.dataSource;
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): Date {
        return this.clock.now();
    }

    protected get runs(): Repository<RunEntity> {
        return this.dataSource.getRepository(RunEntity);
    }

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
}

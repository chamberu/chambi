/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '@chamvi/core';
import type { IClock, IIdempotencyRepository } from '@chamvi/core';
import { LessThanOrEqual } from 'typeorm';
import type { DataSource, Repository } from 'typeorm';
import { IdempotencyKeyEntity } from '../entities/index.ts';
import type { DatabaseStoreOptions } from '../repository/types.ts';

export class DatabaseIdempotencyRepository implements IIdempotencyRepository {
    protected dataSource: DataSource;

    protected clock: IClock;

    constructor(opts: DatabaseStoreOptions) {
        this.dataSource = opts.dataSource;
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): Date {
        return this.clock.now();
    }

    protected get idempotencyKeys(): Repository<IdempotencyKeyEntity> {
        return this.dataSource.getRepository(IdempotencyKeyEntity);
    }

    async claim(scope: string, key: string, runId: string, ttlMs: number): Promise<{ created: boolean; runId: string }> {
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

    /** Delete rows expired at the supplied time (default: the clock). */
    async purgeExpired(now: Date = this.now()): Promise<number> {
        const result = await this.idempotencyKeys.delete({ expiresAt: LessThanOrEqual(now) });

        return result.affected ?? 0;
    }
}

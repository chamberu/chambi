/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '@chamvi/core';
import type { IClock, ILockStore } from '@chamvi/core';
import { LessThanOrEqual } from 'typeorm';
import type { DataSource, Repository } from 'typeorm';
import { LockEntity } from '../entities/index.ts';
import type { TypeormStoresOptions } from '../store/types.ts';

export class TypeormLockStore implements ILockStore {
    protected dataSource: DataSource;

    protected clock: IClock;

    constructor(opts: TypeormStoresOptions) {
        this.dataSource = opts.dataSource;
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): Date {
        return this.clock.now();
    }

    protected get locks(): Repository<LockEntity> {
        return this.dataSource.getRepository(LockEntity);
    }

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

    /** Delete rows expired at the supplied time (default: the clock). */
    async purgeExpired(now: Date = this.now()): Promise<number> {
        const result = await this.locks.delete({ expiresAt: LessThanOrEqual(now) });
        return result.affected ?? 0;
    }
}

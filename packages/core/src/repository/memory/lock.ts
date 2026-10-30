/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '../../clock/index.ts';
import type { IClock } from '../../clock/index.ts';
import type { ILockRepository } from '../types.ts';
import type { Expiring } from './types.ts';

export class MemoryLockRepository implements ILockRepository {
    protected clock: IClock;

    protected locks = new Map<string, Expiring & { owner: string }>();

    constructor(opts: { clock?: IClock } = {}) {
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): number {
        return this.clock.now().getTime();
    }

    async acquire(key: string, owner: string, ttlMs: number): Promise<boolean> {
        const now = this.now();
        const existing = this.locks.get(key);
        if (existing && existing.expiresAt > now) return false;
        this.locks.set(key, { owner, expiresAt: now + ttlMs });
        return true;
    }

    async release(key: string, owner: string): Promise<void> {
        if (this.locks.get(key)?.owner === owner) this.locks.delete(key);
    }
}

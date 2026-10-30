/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '../../clock/index.ts';
import type { IClock } from '../../clock/index.ts';
import type { IIdempotencyRepository } from '../types.ts';
import type { Expiring } from './types.ts';

export class MemoryIdempotencyRepository implements IIdempotencyRepository {
    protected clock: IClock;

    protected keys = new Map<string, Expiring & { runId: string }>();

    constructor(opts: { clock?: IClock } = {}) {
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): number {
        return this.clock.now().getTime();
    }

    async claim(scope: string, key: string, runId: string, ttlMs: number): Promise<{ created: boolean; runId: string }> {
        const id = `${scope}\0${key}`;
        const now = this.now();
        const existing = this.keys.get(id);

        if (existing && existing.expiresAt > now) {
            return { created: false, runId: existing.runId };
        }

        this.keys.set(id, { runId, expiresAt: now + ttlMs });

        return { created: true, runId };
    }
}

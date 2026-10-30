/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { systemClock } from '../../clock/index.ts';
import type { IClock } from '../../clock/index.ts';
import { InvalidRunStateError, RepositoryNotFoundError, RunNotFoundError } from '../../errors/index.ts';
import type { Run } from '../../run/types.ts';
import { normalizeEnvelope } from '../../trigger/helpers.ts';
import type { IRunRepository, RunFindOptions } from '../types.ts';
import { copy } from './helpers.ts';

/** A copy of a stored run; an envelope of the pre-channel shape (`source`, `thread`) reads as the current one. */
function readRun(run: Run): Run {
    const out = copy(run);
    out.trigger = normalizeEnvelope(out.trigger as unknown as Record<string, unknown>);
    return out;
}

export class MemoryRunRepository implements IRunRepository {
    protected clock: IClock;

    protected runs = new Map<string, Run>();

    constructor(opts: { clock?: IClock } = {}) {
        this.clock = opts.clock ?? systemClock;
    }

    protected now(): number {
        return this.clock.now().getTime();
    }

    async insert(run: Run): Promise<boolean> {
        if (this.runs.has(run.id)) return false;
        this.runs.set(run.id, copy(run));
        return true;
    }

    async findOneOrFail(id: string): Promise<Run> {
        const result = await this.findOne(id);
        if (result === undefined) throw new RunNotFoundError(id);
        return result;
    }

    async findOrFail(q: RunFindOptions): Promise<{ data: Run[]; total: number }> {
        const result = await this.find(q);
        if (result.data.length === 0) throw new RepositoryNotFoundError('runs');
        return result;
    }

    async findOne(id: string): Promise<Run | undefined> {
        const run = this.runs.get(id);
        return run ? readRun(run) : undefined;
    }

    async update(
        id: string,
        patch: Partial<Run>,
        opts: { expectStatus?: Run['status'][]; expectOwner?: string } = {},
    ): Promise<Run> {
        const run = this.runs.get(id);
        if (!run) throw new RunNotFoundError(id);
        if (opts.expectStatus && !opts.expectStatus.includes(run.status)) {
            throw new InvalidRunStateError(
                `Run "${id}" is "${run.status}", expected one of: ${opts.expectStatus.join(', ')}.`,
            );
        }
        if (opts.expectOwner !== undefined && run.claim?.owner !== opts.expectOwner) {
            throw new InvalidRunStateError(
                `Run "${id}" is not claimed by "${opts.expectOwner}" (claim: ${run.claim?.owner ?? 'none'}).`,
            );
        }
        const next = {
            ...run,
            ...copy(patch),
            id,
            updatedAt: patch.updatedAt ? copy(patch.updatedAt) : this.clock.now(),
        };
        this.runs.set(id, next);
        return readRun(next);
    }

    async find(q: RunFindOptions): Promise<{ data: Run[]; total: number }> {
        const direction = q.order === 'desc' ? -1 : 1;
        const matched = this.runs.values().toArray()
            .filter((r) => (q.agent === undefined || r.agent === q.agent) &&
                (q.status === undefined || q.status.includes(r.status)) &&
                (q.concurrencyKey === undefined || r.concurrencyKey === q.concurrencyKey))
            .sort((a, b) => direction * (a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id, 'en')));
        const offset = q.offset ?? 0;
        const end = q.limit === undefined ? undefined : offset + q.limit;
        return { data: matched.slice(offset, end).map((r) => readRun(r)), total: matched.length };
    }

    async claim(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const run = this.runs.get(id);
        if (!run) return false;
        const now = this.now();
        if (run.claim && run.claim.expiresAt.getTime() > now) return false;
        run.claim = { owner, expiresAt: new Date(now + ttlMs) };
        return true;
    }

    async renewClaim(id: string, owner: string, ttlMs: number): Promise<boolean> {
        const run = this.runs.get(id);
        const now = this.now();
        if (!run?.claim || run.claim.owner !== owner || run.claim.expiresAt.getTime() <= now) return false;
        run.claim = { owner, expiresAt: new Date(now + ttlMs) };
        return true;
    }
}

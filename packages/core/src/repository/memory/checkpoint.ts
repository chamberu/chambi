/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '../../errors/index.ts';
import type { Checkpoint } from '../../run/types.ts';
import type { ICheckpointRepository } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryCheckpointRepository implements ICheckpointRepository {
    protected checkpoints = new Map<string, Checkpoint>();

    async save(cp: Checkpoint): Promise<void> {
        const current = this.checkpoints.get(cp.runId);
        if (!current || cp.stepIndex >= current.stepIndex) {
            this.checkpoints.set(cp.runId, copy(cp));
        }
    }

    async findOneOrFail(runId: string): Promise<Checkpoint> {
        const result = await this.findOne(runId);
        if (result === undefined) throw new RepositoryNotFoundError('checkpoints');
        return result;
    }

    async findOne(runId: string): Promise<Checkpoint | undefined> {
        const cp = this.checkpoints.get(runId);
        return cp ? copy(cp) : undefined;
    }
}

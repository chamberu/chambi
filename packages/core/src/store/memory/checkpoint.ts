/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Checkpoint } from '../../run/types.ts';
import type { ICheckpointStore } from '../types.ts';
import { copy } from './helpers.ts';

export class MemoryCheckpointStore implements ICheckpointStore {
    protected checkpoints = new Map<string, Checkpoint>();

    async saveCheckpoint(cp: Checkpoint): Promise<void> {
        const current = this.checkpoints.get(cp.runId);
        if (!current || cp.stepIndex >= current.stepIndex) {
            this.checkpoints.set(cp.runId, copy(cp));
        }
    }

    async latestCheckpoint(runId: string): Promise<Checkpoint | undefined> {
        const cp = this.checkpoints.get(runId);
        return cp ? copy(cp) : undefined;
    }
}

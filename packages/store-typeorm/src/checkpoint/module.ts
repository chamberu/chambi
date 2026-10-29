/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Checkpoint, ICheckpointStore } from '@chamvi/core';
import { LessThanOrEqual } from 'typeorm';
import type { DataSource, Repository } from 'typeorm';
import { CheckpointEntity } from '../entities/index.ts';
import { toCheckpoint, toCheckpointValues } from '../store/helpers.ts';

export class TypeormCheckpointStore implements ICheckpointStore {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get checkpoints(): Repository<CheckpointEntity> {
        return this.dataSource.getRepository(CheckpointEntity);
    }

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
}

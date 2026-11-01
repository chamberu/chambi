/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { RepositoryNotFoundError } from '@chamvi/core';
import type { Checkpoint, ICheckpointRepository } from '@chamvi/core';
import { LessThanOrEqual } from 'typeorm';
import type { DataSource, Repository } from 'typeorm';
import { CheckpointEntity } from '../entities/index.ts';
import { toCheckpoint, toCheckpointValues, withRunReference } from '../repository/helpers.ts';

export class DatabaseCheckpointRepository implements ICheckpointRepository {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get checkpoints(): Repository<CheckpointEntity> {
        return this.dataSource.getRepository(CheckpointEntity);
    }

    async save(cp: Checkpoint): Promise<void> {
        await withRunReference(this.dataSource, cp.runId, () => this.checkpoints.createQueryBuilder()
            .insert()
            .values(toCheckpointValues(cp))
            .orUpdate(
                ['step_index', 'messages', 'finish_reason', 'created_at', 'conversation_scope_id', 'conversation_generation'],
                ['run_id'],
                { overwriteCondition: { where: { stepIndex: LessThanOrEqual(cp.stepIndex) } } },
            )
            .updateEntity(false)
            .execute());
    }

    async findOne(runId: string): Promise<Checkpoint | undefined> {
        const entity = await this.checkpoints.findOneBy({ runId });

        return entity ? toCheckpoint(entity) : undefined;
    }

    async findOneOrFail(runId: string): Promise<Checkpoint> {
        const result = await this.findOne(runId);

        if (result === undefined) {
            throw new RepositoryNotFoundError('checkpoints');
        }

        return result;
    }
}

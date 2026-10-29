/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IStepStore, Step } from '@chamvi/core';
import type { DataSource, Repository } from 'typeorm';
import { StepEntity } from '../entities/index.ts';
import { toStep, toStepValues } from '../store/helpers.ts';

export class TypeormStepStore implements IStepStore {
    protected dataSource: DataSource;

    constructor(opts: { dataSource: DataSource }) {
        this.dataSource = opts.dataSource;
    }

    protected get steps(): Repository<StepEntity> {
        return this.dataSource.getRepository(StepEntity);
    }

    async appendStep(step: Step): Promise<void> {
        await this.steps.createQueryBuilder()
            .insert()
            .values(toStepValues(step))
            .updateEntity(false)
            .execute();
    }

    async listSteps(runId: string): Promise<Step[]> {
        const entities = await this.steps.find({
            where: { runId },
            order: { index: 'ASC', seq: 'ASC' },
        });
        return entities.map((entity) => toStep(entity));
    }
}

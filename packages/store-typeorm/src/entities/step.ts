/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Column,
    Entity,
    ForeignKey,
    Index,
    PrimaryGeneratedColumn,
} from 'typeorm';
import type { Step } from '@chamvi/core';
import { OPTIONAL_JSON_TRANSFORMER, TableName } from './constants.ts';
import { RunEntity } from './run.ts';

@Index(['runId', 'index'])
@Entity({ name: TableName.STEPS })
export class StepEntity {
    @PrimaryGeneratedColumn('increment', { name: 'seq', type: 'bigint' })
    seq!: string;

    @Column({
        name: 'run_id', 
        type: 'varchar', 
        length: 128, 
    })
    @ForeignKey(() => RunEntity, 'id')
    runId!: string;

    @Column({ name: 'step_index', type: 'integer' })
    index!: number;

    @Column({
        name: 'kind', 
        type: 'varchar', 
        length: 8, 
    })
    kind!: Step['kind'];

    @Column({
        name: 'name',
        type: 'varchar',
        length: 255,
        nullable: true,
    })
    name!: string | null;

    @Column({
        name: 'input', 
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    input!: unknown;

    @Column({
        name: 'output', 
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    output!: unknown;

    @Column({
        name: 'error', 
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    error!: unknown;

    @Column({ name: 'started_at', type: 'timestamp with time zone' })
    startedAt!: Date;

    @Column({ name: 'finished_at', type: 'timestamp with time zone' })
    finishedAt!: Date;
}

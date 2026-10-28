/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Column,
    Entity,
    PrimaryColumn,
} from 'typeorm';
import type { Checkpoint } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, OPTIONAL_JSON_TRANSFORMER, TableName } from './constants.ts';

@Entity({ name: TableName.CHECKPOINTS })
export class CheckpointEntity {
    @PrimaryColumn({
        name: 'run_id', 
        type: 'varchar', 
        length: 128, 
    })
    runId!: string;

    @Column({
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    conversation!: Checkpoint['conversation'] | null;

    @Column({ name: 'step_index', type: 'integer' })
    stepIndex!: number;

    @Column({
        name: 'messages',
        type: 'jsonb',
        transformer: JSON_VALUE_TRANSFORMER,
    })
    messages!: Checkpoint['messages'];

    @Column({
        name: 'finish_reason',
        type: 'varchar',
        length: 64,
        nullable: true,
    })
    finishReason!: NonNullable<Checkpoint['finishReason']> | null;

    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
}

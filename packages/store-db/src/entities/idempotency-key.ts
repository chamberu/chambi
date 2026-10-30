/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Column,
    Entity,
    Index,
    PrimaryColumn,
} from 'typeorm';
import { TableName } from './constants.ts';

@Entity({ name: TableName.IDEMPOTENCY_KEYS })
export class IdempotencyKeyEntity {
    @PrimaryColumn({
        name: 'scope', 
        type: 'varchar', 
        length: 1024, 
    })
    scope!: string;

    @PrimaryColumn({
        name: 'key', 
        type: 'varchar', 
        length: 512, 
    })
    key!: string;

    @Column({
        name: 'run_id', 
        type: 'varchar', 
        length: 128, 
    })
    // The reservation precedes createRun and can outlive a failed creation.
    runId!: string;

    @Index()
    @Column({ name: 'expires_at', type: 'timestamp with time zone' })
    expiresAt!: Date;
}

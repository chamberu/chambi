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

@Entity({ name: TableName.LOCKS })
export class LockEntity {
    @PrimaryColumn({
        name: 'key', 
        type: 'varchar', 
        length: 512, 
    })
    key!: string;

    @Column({
        name: 'owner', 
        type: 'varchar', 
        length: 255, 
    })
    owner!: string;

    @Index()
    @Column({ name: 'expires_at', type: 'timestamp with time zone' })
    expiresAt!: Date;
}

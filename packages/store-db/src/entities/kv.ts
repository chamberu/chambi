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
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

@Entity({ name: TableName.KV })
export class KvEntity {
    @PrimaryColumn({
        name: 'agent', 
        type: 'varchar', 
        length: 64, 
    })
    agent!: string;

    @PrimaryColumn({
        name: 'key',
        type: 'varchar',
        length: 512,
        collation: 'C',
    })
    key!: string;

    @Column({
        name: 'value',
        type: 'jsonb',
        transformer: JSON_VALUE_TRANSFORMER,
    })
    value!: unknown;
}

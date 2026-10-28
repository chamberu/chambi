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
    PrimaryGeneratedColumn,
} from 'typeorm';
import type { ConversationItem } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

@Index(['scopeId', 'generation', 'id'], { unique: true })
@Index(['scopeId', 'generation', 'createdAt', 'seq'])
@Entity({ name: TableName.CONVERSATION_ITEMS })
export class ConversationItemEntity {
    @PrimaryGeneratedColumn('increment', { type: 'bigint' })
    seq!: string;
    @Column({
        name: 'scope_id',
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
    scopeId!: string;
    @Column({ type: 'integer' })
    generation!: number;
    @Column({ type: 'text', collation: 'C' })
    id!: string;
    @Column({
        name: 'run_id',
        type: 'text',
        collation: 'C',
    })
    runId!: string;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
    @Column({ type: 'jsonb', transformer: JSON_VALUE_TRANSFORMER })
    item!: ConversationItem;
}

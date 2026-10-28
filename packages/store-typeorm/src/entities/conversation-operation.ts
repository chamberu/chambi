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
import type { ConversationNoteResult } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

@Index(['scopeId', 'createdAt', 'id'])
@Entity({ name: TableName.CONVERSATION_OPERATIONS })
export class ConversationOperationEntity {
    @PrimaryColumn({
        name: 'scope_id',
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
    scopeId!: string;
    @PrimaryColumn({ type: 'integer' })
    generation!: number;
    @PrimaryColumn({ type: 'text', collation: 'C' })
    id!: string;
    @Column({
        name: 'run_id',
        type: 'text',
        collation: 'C',
    })
    runId!: string;
    @Column({ name: 'input_hash', type: 'text' })
    inputHash!: string;
    @Column({ type: 'jsonb', transformer: JSON_VALUE_TRANSFORMER })
    result!: ConversationNoteResult;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
}

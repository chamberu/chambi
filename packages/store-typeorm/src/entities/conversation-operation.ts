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
    PrimaryColumn,
} from 'typeorm';
import type { ConversationNoteResult } from '@chamvi/core';
import { TableName } from './constants.ts';
import { ConversationEntity } from './conversation.ts';
import { RunEntity } from './run.ts';

@Index(['scopeId', 'createdAt', 'id'])
@Entity({ name: TableName.CONVERSATION_OPERATIONS })
export class ConversationOperationEntity {
    @PrimaryColumn({
        name: 'scope_id',
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
    @ForeignKey(() => ConversationEntity, 'id')
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
    @ForeignKey(() => RunEntity, 'id')
    runId!: string;
    @Column({ name: 'input_hash', type: 'text' })
    inputHash!: string;
    @Column({ type: 'text' })
    kind!: ConversationNoteResult['kind'];
    @Column({ type: 'text', collation: 'C' })
    // Receipts survive note deletion, so this is result metadata rather than a note foreign key.
    key!: string;
    @Column({ type: 'boolean', nullable: true })
    removed!: boolean | null;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
}

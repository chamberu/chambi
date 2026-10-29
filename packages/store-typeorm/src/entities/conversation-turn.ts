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
import type { ConversationSnapshot } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';
import { ConversationEntity } from './conversation.ts';

@Index(['scopeId', 'createdAt', 'runId'])
@Entity({ name: TableName.CONVERSATION_TURNS })
export class ConversationTurnEntity {
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
    @PrimaryColumn({
        name: 'run_id',
        type: 'text',
        collation: 'C',
    })
    runId!: string;
    @Column({ type: 'jsonb', transformer: JSON_VALUE_TRANSFORMER })
    messages!: ConversationSnapshot['messages'];
    @Column({
        name: 'item_ids',
        type: 'text',
        array: true,
    })
    itemIds!: string[];
    @Column({
        name: 'note_keys',
        type: 'text',
        array: true,
    })
    noteKeys!: string[];
    @Column({ type: 'integer' })
    omitted!: number;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
}

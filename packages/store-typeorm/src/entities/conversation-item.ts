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
import type { ConversationItem } from '@chamvi/core';
import { TableName } from './constants.ts';
import { ConversationEntity } from './conversation.ts';
import { RunEntity } from './run.ts';

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
    @ForeignKey(() => ConversationEntity, 'id')
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
    @ForeignKey(() => RunEntity, 'id')
    runId!: string;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
    @Column({ type: 'text' })
    role!: ConversationItem['role'];
    @Column({ type: 'text' })
    text!: string;
    @Column({ type: 'text' })
    status!: ConversationItem['status'];
    @Column({
        name: 'effect_key',
        type: 'text',
        nullable: true,
    })
    // Journaled before the receipt exists; uncertain sends may never produce one.
    effectKey!: string | null;
    @Column({
        name: 'target_channel',
        type: 'text',
        nullable: true,
    })
    targetChannel!: string | null;
    @Column({
        name: 'target_address',
        type: 'text',
        nullable: true,
    })
    targetAddress!: string | null;
}

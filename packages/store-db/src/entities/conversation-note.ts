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
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { TableName } from './constants.ts';
import { ConversationEntity } from './conversation.ts';
import { RunEntity } from './run.ts';

@Index(['expiresAt'])
@Entity({ name: TableName.CONVERSATION_NOTES })
export class ConversationNoteEntity {
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
    key!: string;

    @Column({ type: 'text' })
    text!: string;

    @Column({
        name: 'run_id',
        type: 'varchar',
        length: 128,
        collation: 'C',
    })
    runId!: string;

    @Column({ name: 'tool_call_id', type: 'text' })
    toolCallId!: string;

    @Column({ name: 'step_index', type: 'integer' })
    stepIndex!: number;

    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;

    @Column({ name: 'updated_at', type: 'timestamp with time zone' })
    updatedAt!: Date;

    @Column({
        name: 'expires_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    expiresAt!: Date | null;

    @ManyToOne(() => ConversationEntity, {
        nullable: false,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    @JoinColumn({ name: 'scope_id', referencedColumnName: 'id' })
    conversation?: Relation<ConversationEntity>;

    @ManyToOne(() => RunEntity, {
        nullable: false,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    @JoinColumn({ name: 'run_id', referencedColumnName: 'id' })
    run?: Relation<RunEntity>;
}

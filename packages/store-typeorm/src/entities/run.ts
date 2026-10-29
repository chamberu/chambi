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
import type { Run, RunStatusLiteral, Usage } from '@chamvi/core';
import { OPTIONAL_JSON_TRANSFORMER, TableName } from './constants.ts';
import { ConversationEntity } from './conversation.ts';

@Index(['agent', 'status', 'concurrencyKey'])
@Index(['status', 'createdAt', 'id'])
@Entity({ name: TableName.RUNS })
export class RunEntity {
    @PrimaryColumn({
        name: 'id',
        type: 'varchar',
        length: 128,
        collation: 'C',
    })
    id!: string;

    @Column({
        name: 'agent',
        type: 'varchar',
        length: 64,
    })
    agent!: string;

    @Column({
        name: 'status',
        type: 'varchar',
        length: 16,
    })
    status!: RunStatusLiteral;

    @Column({
        name: 'trigger',
        type: 'jsonb',
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    trigger!: Record<string, unknown>;

    @Column({
        name: 'concurrency_key',
        type: 'varchar',
        length: 255,
        nullable: true,
    })
    concurrencyKey!: string | null;

    @Column({
        name: 'thread',
        type: 'varchar',
        length: 255,
        nullable: true,
    })
    /** The column keeps its name from before channels (no migration). */
    address!: string | null;

    @Column({
        name: 'output',
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    output!: unknown;

    @Column({
        name: 'error',
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    error!: NonNullable<Run['error']> | null;

    @Column({
        name: 'usage',
        type: 'jsonb',
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    usage!: Usage;

    @Column({
        name: 'waiting',
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    waiting!: Record<string, unknown> | null;

    @Column({
        name: 'claim_owner',
        type: 'varchar',
        length: 255,
        nullable: true,
    })
    claimOwner!: string | null;

    @Column({
        name: 'claim_expires_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    claimExpiresAt!: Date | null;

    @Column({
        name: 'cancel_requested',
        type: 'boolean',
        nullable: true,
    })
    cancelRequested!: boolean | null;

    @Column({
        name: 'conversation_scope_id',
        type: 'varchar',
        length: 64,
        nullable: true,
    })
    conversationScopeId!: string | null;
    @Column({
        name: 'conversation_generation',
        type: 'integer',
        nullable: true,
    })
    conversationGeneration!: number | null;
    @Column({
        name: 'conversation_agent',
        type: 'text',
        nullable: true,
    })
    conversationAgent!: string | null;
    @Column({
        name: 'conversation_channel',
        type: 'text',
        nullable: true,
    })
    conversationChannel!: string | null;
    @Column({
        name: 'conversation_account',
        type: 'text',
        nullable: true,
    })
    conversationAccount!: string | null;
    @Column({
        name: 'conversation_chat',
        type: 'text',
        nullable: true,
    })
    conversationChat!: string | null;
    @Column({
        name: 'conversation_audience',
        type: 'text',
        nullable: true,
    })
    conversationAudience!: string | null;
    @Column({
        name: 'conversation_text',
        type: 'text',
        nullable: true,
    })
    conversationText!: string | null;

    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;

    @Column({ name: 'updated_at', type: 'timestamp with time zone' })
    updatedAt!: Date;

    @Column({
        name: 'started_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    startedAt!: Date | null;

    @Column({
        name: 'finished_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    finishedAt!: Date | null;
    @ManyToOne(() => ConversationEntity, {
        nullable: true,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    @JoinColumn({ name: 'conversation_scope_id', referencedColumnName: 'id' })
    conversation?: Relation<ConversationEntity> | null;
}

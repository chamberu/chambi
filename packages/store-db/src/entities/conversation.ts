/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    Column,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import type { ConversationSnapshot } from '@chamvi/core';
import { OPTIONAL_JSON_TRANSFORMER, TableName } from './constants.ts';
import { RunEntity } from './run.ts';

@Entity({ name: TableName.CONVERSATIONS })
export class ConversationEntity {
    @PrimaryColumn({
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
    id!: string;
    @Column({ type: 'text', collation: 'C' })
    agent!: string;
    @Column({ type: 'text', collation: 'C' })
    channel!: string;
    @Column({ type: 'text', collation: 'C' })
    account!: string;
    @Column({ type: 'text', collation: 'C' })
    chat!: string;
    @Column({ type: 'text', collation: 'C' })
    audience!: string;
    @Column({ type: 'integer' })
    generation!: number;
    @Column({
        name: 'active_run_id',
        type: 'varchar',
        length: 128,
        nullable: true,
    })
    activeRunId!: string | null;
    @Column({
        name: 'snapshot_messages',
        type: 'jsonb',
        nullable: true,
        transformer: OPTIONAL_JSON_TRANSFORMER,
    })
    snapshotMessages!: ConversationSnapshot['messages'] | null;
    @Column({
        name: 'snapshot_item_ids',
        type: 'text',
        array: true,
        nullable: true,
    })
    snapshotItemIds!: string[] | null;
    @Column({
        name: 'snapshot_note_keys',
        type: 'text',
        array: true,
        nullable: true,
    })
    snapshotNoteKeys!: string[] | null;
    @Column({
        name: 'snapshot_created_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    snapshotCreatedAt!: Date | null;
    @Column({
        name: 'snapshot_omitted',
        type: 'integer',
        nullable: true,
    })
    snapshotOmitted!: number | null;
    @ManyToOne(() => RunEntity, {
        nullable: true,
        onDelete: 'NO ACTION',
        onUpdate: 'NO ACTION',
    })
    @JoinColumn({ name: 'active_run_id', referencedColumnName: 'id' })
    activeRun?: Relation<RunEntity> | null;
}

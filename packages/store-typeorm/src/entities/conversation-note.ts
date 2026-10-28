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
import type { ConversationNote } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

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
    @Column({ type: 'jsonb', transformer: JSON_VALUE_TRANSFORMER })
    note!: ConversationNote;
    @Column({
        name: 'expires_at',
        type: 'timestamp with time zone',
        nullable: true,
    })
    expiresAt!: Date | null;
}

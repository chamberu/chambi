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
import type { ConversationSnapshot } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

@Index(['scopeId', 'createdAt', 'runId'])
@Entity({ name: TableName.CONVERSATION_TURNS })
export class ConversationTurnEntity {
    @PrimaryColumn({
        name: 'scope_id',
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
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
    snapshot!: ConversationSnapshot;
    @Column({ name: 'created_at', type: 'timestamp with time zone' })
    createdAt!: Date;
}

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { ConversationIdentity } from '@chamvi/core';
import { JSON_VALUE_TRANSFORMER, TableName } from './constants.ts';

@Entity({ name: TableName.CONVERSATIONS })
export class ConversationEntity {
    @PrimaryColumn({
        type: 'varchar',
        length: 64,
        collation: 'C',
    })
    id!: string;
    @Column({ type: 'jsonb', transformer: JSON_VALUE_TRANSFORMER })
    identity!: ConversationIdentity;
    @Column({ type: 'integer' })
    generation!: number;
    @Column({
        name: 'active_run_id',
        type: 'text',
        nullable: true,
    })
    activeRunId!: string | null;
}

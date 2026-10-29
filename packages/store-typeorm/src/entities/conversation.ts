/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TableName } from './constants.ts';

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
        type: 'text',
        nullable: true,
    })
    activeRunId!: string | null;
}

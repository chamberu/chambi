/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationBindings1792800000000 implements MigrationInterface {
    name = 'ConversationBindings1792800000000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE chamvi_runs ADD COLUMN conversation jsonb');
        await queryRunner.query('ALTER TABLE chamvi_checkpoints ADD COLUMN conversation jsonb');
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE chamvi_checkpoints DROP COLUMN conversation');
        await queryRunner.query('ALTER TABLE chamvi_runs DROP COLUMN conversation');
    }
}

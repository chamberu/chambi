/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class RunTaint1792800000000 implements MigrationInterface {
    name = 'RunTaint1792800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "taint" jsonb');
        // Resumable legacy runs may already contain untrusted checkpoint content.
        await queryRunner.query(`
            UPDATE "chamvi_runs"
            SET "taint" = jsonb_build_object('at', CURRENT_TIMESTAMP, 'source', 'migration:legacy-run')
            WHERE "status" IN ('queued', 'running', 'waiting', 'interrupted')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "taint"');
    }
}

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationBindings1792800000000 implements MigrationInterface {
    name = 'ConversationBindings1792800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD "conversation_scope_id" character varying(64)');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD "conversation_generation" integer');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD "conversation_snapshot_run_id" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_scope_id" character varying(64)');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_generation" integer');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_agent" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_channel" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_account" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_chat" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_audience" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_text" text');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_text"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_audience"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_chat"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_account"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_channel"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_agent"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_generation"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_scope_id"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP COLUMN "conversation_snapshot_run_id"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP COLUMN "conversation_generation"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP COLUMN "conversation_scope_id"');
    }
}

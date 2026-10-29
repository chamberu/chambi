/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1792195200000 implements MigrationInterface {
    name = 'Init1792195200000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "chamvi_checkpoints" (
                "run_id" character varying(128) NOT NULL,
                "step_index" integer NOT NULL,
                "messages" jsonb NOT NULL,
                "finish_reason" character varying(64),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_d0549bdaf44100277f3573561cb" PRIMARY KEY ("run_id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_docs" (
                "agent" character varying(64) NOT NULL,
                "collection" character varying(255) NOT NULL,
                "id" character varying(255) NOT NULL,
                "doc" jsonb NOT NULL,
                CONSTRAINT "PK_4295fefb3d07b2b59edd03bb7e5" PRIMARY KEY ("agent", "collection", "id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_chamvi_docs_doc_gin" ON "chamvi_docs" USING gin ("doc")
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_effects" (
                "key" character varying(512) NOT NULL,
                "result" jsonb,
                CONSTRAINT "PK_7fb2e468cabe232a81c1b268f34" PRIMARY KEY ("key")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_idempotency_keys" (
                "scope" character varying(255) NOT NULL,
                "key" character varying(512) NOT NULL,
                "run_id" character varying(128) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_2627332526e8e1c262f044d0cb8" PRIMARY KEY ("scope", "key")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_4a19fe98858eeb058da8a23da5" ON "chamvi_idempotency_keys" ("expires_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_kv" (
                "agent" character varying(64) NOT NULL,
                "key" character varying(512) NOT NULL,
                "value" jsonb NOT NULL,
                CONSTRAINT "PK_d233cd69d8b336316095d52d725" PRIMARY KEY ("agent", "key")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_locks" (
                "key" character varying(512) NOT NULL,
                "owner" character varying(255) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_836a0a3a636b596077033fda072" PRIMARY KEY ("key")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_c56298596772b49f21f447b0c1" ON "chamvi_locks" ("expires_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_runs" (
                "id" character varying(128) COLLATE "C" NOT NULL,
                "agent" character varying(64) NOT NULL,
                "status" character varying(16) NOT NULL,
                "trigger" jsonb NOT NULL,
                "concurrency_key" character varying(255),
                "thread" character varying(255),
                "output" jsonb,
                "error" jsonb,
                "usage" jsonb NOT NULL,
                "waiting" jsonb,
                "claim_owner" character varying(255),
                "claim_expires_at" TIMESTAMP WITH TIME ZONE,
                "cancel_requested" boolean,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "started_at" TIMESTAMP WITH TIME ZONE,
                "finished_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "PK_a2178a599d194316d8202924a52" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_ff7160783f3efb05a7092227e0" ON "chamvi_runs" ("status", "created_at", "id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_d45da2a6da9f1ffa9a258362e5" ON "chamvi_runs" ("agent", "status", "concurrency_key")
        `);
        await queryRunner.query(`
            CREATE TABLE "chamvi_steps" (
                "seq" BIGSERIAL NOT NULL,
                "run_id" character varying(128) NOT NULL,
                "step_index" integer NOT NULL,
                "kind" character varying(8) NOT NULL,
                "name" character varying(255),
                "input" jsonb,
                "output" jsonb,
                "error" jsonb,
                "started_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                "finished_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_dbba1edf4658fb65f51ca470e85" PRIMARY KEY ("seq")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_520ee8478aecbdd2416de5c891" ON "chamvi_steps" ("run_id", "step_index")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "IDX_520ee8478aecbdd2416de5c891"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_steps"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_d45da2a6da9f1ffa9a258362e5"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_ff7160783f3efb05a7092227e0"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_runs"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_c56298596772b49f21f447b0c1"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_locks"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_kv"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_4a19fe98858eeb058da8a23da5"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_idempotency_keys"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_effects"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_chamvi_docs_doc_gin"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_docs"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_checkpoints"
        `);
    }
}

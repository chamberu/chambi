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
            CREATE TABLE "checkpoints" (
                "run_id" character varying(128) NOT NULL,
                "step_index" integer NOT NULL,
                "messages" jsonb NOT NULL,
                "finish_reason" character varying(64),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_fc05aeda8e7c284b6043fba5b44" PRIMARY KEY ("run_id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "docs" (
                "agent" character varying(64) NOT NULL,
                "collection" character varying(255) NOT NULL,
                "id" character varying(255) NOT NULL,
                "doc" jsonb NOT NULL,
                CONSTRAINT "PK_8f493e53e0762798055bee4e2bf" PRIMARY KEY ("agent", "collection", "id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_docs_doc_gin" ON "docs" USING gin ("doc")
        `);
        await queryRunner.query(`
            CREATE TABLE "effects" (
                "key" character varying(512) NOT NULL,
                "result" jsonb,
                CONSTRAINT "PK_1b35e6bd37b4c9e4dc736d6070c" PRIMARY KEY ("key")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "idempotency_keys" (
                "scope" character varying(255) NOT NULL,
                "key" character varying(512) NOT NULL,
                "run_id" character varying(128) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_15de2f76fa9f27ad8f330983607" PRIMARY KEY ("scope", "key")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_e5fc0731b6752a8e9194fa265e" ON "idempotency_keys" ("expires_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "kv" (
                "agent" character varying(64) NOT NULL,
                "key" character varying(512) NOT NULL,
                "value" jsonb NOT NULL,
                CONSTRAINT "PK_9aa12176a3088d3b7a377b57df2" PRIMARY KEY ("agent", "key")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "locks" (
                "key" character varying(512) NOT NULL,
                "owner" character varying(255) NOT NULL,
                "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_c6e1e10d298aec42ba087dd57e5" PRIMARY KEY ("key")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_f6394fa25f79abcc9518496701" ON "locks" ("expires_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "runs" (
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
                CONSTRAINT "PK_46d6a1e257c38ba58f1a3c30836" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_39fad77ab2c4ffcf7ace1d92b5" ON "runs" ("status", "created_at", "id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_9f8a3908fe24b0f8a090fe5298" ON "runs" ("agent", "status", "concurrency_key")
        `);
        await queryRunner.query(`
            CREATE TABLE "steps" (
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
                CONSTRAINT "PK_488d21d4a382bb21c49f3e8bb9c" PRIMARY KEY ("seq")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_a4a63b74eeef011be2d94eced7" ON "steps" ("run_id", "step_index")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "IDX_a4a63b74eeef011be2d94eced7"
        `);
        await queryRunner.query(`
            DROP TABLE "steps"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_9f8a3908fe24b0f8a090fe5298"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_39fad77ab2c4ffcf7ace1d92b5"
        `);
        await queryRunner.query(`
            DROP TABLE "runs"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_f6394fa25f79abcc9518496701"
        `);
        await queryRunner.query(`
            DROP TABLE "locks"
        `);
        await queryRunner.query(`
            DROP TABLE "kv"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_e5fc0731b6752a8e9194fa265e"
        `);
        await queryRunner.query(`
            DROP TABLE "idempotency_keys"
        `);
        await queryRunner.query(`
            DROP TABLE "effects"
        `);
        await queryRunner.query(`
            DROP INDEX "IDX_docs_doc_gin"
        `);
        await queryRunner.query(`
            DROP TABLE "docs"
        `);
        await queryRunner.query(`
            DROP TABLE "checkpoints"
        `);
    }
}

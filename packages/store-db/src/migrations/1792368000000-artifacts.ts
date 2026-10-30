/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Artifacts1792368000000 implements MigrationInterface {
    name = 'Artifacts1792368000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "chamvi_artifacts" (
                "id" character varying(128) COLLATE "C" NOT NULL,
                "run_id" character varying(128) NOT NULL,
                "agent" character varying(64) NOT NULL,
                "media_type" text NOT NULL,
                "filename" text,
                "size" integer NOT NULL,
                "data" bytea NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_3bb29abbf8721c61b09142bd6ce" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_ff9ed484c27b76465c2b54f7cf" ON "chamvi_artifacts" ("run_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "IDX_ff9ed484c27b76465c2b54f7cf"
        `);
        await queryRunner.query(`
            DROP TABLE "chamvi_artifacts"
        `);
    }
}

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
            CREATE TABLE "artifacts" (
                "id" character varying(128) COLLATE "C" NOT NULL,
                "run_id" character varying(128) NOT NULL,
                "agent" character varying(64) NOT NULL,
                "media_type" text NOT NULL,
                "filename" text,
                "size" integer NOT NULL,
                "data" bytea NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_6516bbed3c129918e05c5012edb" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_3468f92022f7d5254bf3240954" ON "artifacts" ("run_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP INDEX "IDX_3468f92022f7d5254bf3240954"
        `);
        await queryRunner.query(`
            DROP TABLE "artifacts"
        `);
    }
}

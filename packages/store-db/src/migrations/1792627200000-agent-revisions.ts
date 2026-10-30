/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AgentRevisions1792627200000 implements MigrationInterface {
    name = 'AgentRevisions1792627200000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "chamvi_agent_revisions" (
                "agent" character varying(64) COLLATE "C" NOT NULL,
                "hash" character varying(128) NOT NULL,
                "changed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
                CONSTRAINT "PK_d355b7063fb6b3201e6d588b511" PRIMARY KEY ("agent")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "chamvi_agent_revisions"
        `);
    }
}

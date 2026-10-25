/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Orders KV keys by code point (`COLLATE "C"`), as `kvList` promises.
 * Written by hand: TypeORM's generated collation change drops and re-adds
 * the column (part of the primary key), `ALTER COLUMN ... TYPE` keeps it.
 */
export class KvKeyCollation1792540800000 implements MigrationInterface {
    name = 'KvKeyCollation1792540800000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "kv" ALTER COLUMN "key" TYPE character varying(512) COLLATE "C"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "kv" ALTER COLUMN "key" TYPE character varying(512) COLLATE "default"
        `);
    }
}

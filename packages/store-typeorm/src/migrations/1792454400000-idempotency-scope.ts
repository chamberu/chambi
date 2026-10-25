/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Widens the idempotency scope to 1024 characters, as it carries the
 * URI-encoded invoker (`<agent>:<source>:<kind>:<id>`). Written by hand:
 * TypeORM's generated length change drops and re-adds the column (and with
 * it every key and the primary key), `ALTER COLUMN ... TYPE` keeps both.
 */
export class IdempotencyScope1792454400000 implements MigrationInterface {
    name = 'IdempotencyScope1792454400000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "idempotency_keys" ALTER COLUMN "scope" TYPE character varying(1024)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // fails while a scope is longer than 255 characters (purge or delete those keys first)
        await queryRunner.query(`
            ALTER TABLE "idempotency_keys" ALTER COLUMN "scope" TYPE character varying(255)
        `);
    }
}

/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Conversations1792713600000 implements MigrationInterface {
    name = 'Conversations1792713600000';

    async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE chamvi_conversations (
            id varchar(64) COLLATE "C" PRIMARY KEY,
            identity jsonb NOT NULL, generation integer NOT NULL, active_run_id text
        )`);
        await queryRunner.query(`CREATE TABLE chamvi_conversation_turns (
            scope_id varchar(64) COLLATE "C" NOT NULL, generation integer NOT NULL,
            run_id text COLLATE "C" NOT NULL, snapshot jsonb NOT NULL,
            created_at timestamptz NOT NULL,
            PRIMARY KEY (scope_id, generation, run_id)
        )`);
        await queryRunner.query(`CREATE TABLE chamvi_conversation_items (
            seq bigserial PRIMARY KEY, scope_id varchar(64) COLLATE "C" NOT NULL,
            generation integer NOT NULL, id text COLLATE "C" NOT NULL,
            run_id text COLLATE "C" NOT NULL, created_at timestamptz NOT NULL, item jsonb NOT NULL
        )`);
        await queryRunner.query(`CREATE TABLE chamvi_conversation_notes (
            scope_id varchar(64) COLLATE "C" NOT NULL, generation integer NOT NULL,
            key text COLLATE "C" NOT NULL, note jsonb NOT NULL, expires_at timestamptz,
            PRIMARY KEY (scope_id, generation, key)
        )`);
        await queryRunner.query(`CREATE TABLE chamvi_conversation_operations (
            scope_id varchar(64) COLLATE "C" NOT NULL, generation integer NOT NULL,
            id text COLLATE "C" NOT NULL, run_id text COLLATE "C" NOT NULL,
            input_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL,
            PRIMARY KEY (scope_id, generation, id)
        )`);
        // Use TypeORM's naming strategy so schema comparison sees the same indexes.
        for (const [table, columns, unique] of [
            ['chamvi_conversation_turns', ['scope_id', 'created_at', 'run_id'], false],
            ['chamvi_conversation_items', ['scope_id', 'generation', 'id'], true],
            ['chamvi_conversation_items', ['scope_id', 'generation', 'created_at', 'seq'], false],
            ['chamvi_conversation_notes', ['expires_at'], false],
            ['chamvi_conversation_operations', ['scope_id', 'created_at', 'id'], false],
        ] as const) {
            const name = queryRunner.connection.namingStrategy.indexName(table, [...columns]);
            await queryRunner.query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX "${name}" ON "${table}" (${columns.map((column) => `"${column}"`).join(', ')})`);
        }
    }

    async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['operations', 'notes', 'items', 'turns']) {
            await queryRunner.query(`DROP TABLE "chamvi_conversation_${table}"`);
        }
        await queryRunner.query('DROP TABLE chamvi_conversations');
    }
}

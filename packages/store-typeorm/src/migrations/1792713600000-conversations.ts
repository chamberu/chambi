/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class Conversations1792713600000 implements MigrationInterface {
    name = 'Conversations1792713600000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "chamvi_conversations" ("id" character varying(64) COLLATE "C" NOT NULL, "agent" text COLLATE "C" NOT NULL, "channel" text COLLATE "C" NOT NULL, "account" text COLLATE "C" NOT NULL, "chat" text COLLATE "C" NOT NULL, "audience" text COLLATE "C" NOT NULL, "generation" integer NOT NULL, "active_run_id" text, "snapshot_messages" jsonb, "snapshot_item_ids" text array, "snapshot_note_keys" text array, "snapshot_created_at" TIMESTAMP WITH TIME ZONE, "snapshot_omitted" integer, CONSTRAINT "PK_d70b087b46b044fb4d5ff1b20be" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_items" ("seq" BIGSERIAL NOT NULL, "scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "id" text COLLATE "C" NOT NULL, "run_id" text COLLATE "C" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "role" text NOT NULL, "text" text NOT NULL, "status" text NOT NULL, "effect_key" text, "target_channel" text, "target_address" text, CONSTRAINT "PK_f777143245b3b360dfbe02a1bc1" PRIMARY KEY ("seq"))');
        await queryRunner.query('CREATE INDEX "IDX_d53928fda61d11e44f785eb2a6" ON "chamvi_conversation_items"  ("scope_id", "generation", "created_at", "seq") ');
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_e33a156ff38559b5139e6a73ae" ON "chamvi_conversation_items"  ("scope_id", "generation", "id") ');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_notes" ("scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "key" text COLLATE "C" NOT NULL, "text" text NOT NULL, "run_id" text COLLATE "C" NOT NULL, "tool_call_id" text NOT NULL, "step_index" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ff451484f567e3a78070456dc53" PRIMARY KEY ("scope_id", "generation", "key"))');
        await queryRunner.query('CREATE INDEX "IDX_cce05651783379a393713278e1" ON "chamvi_conversation_notes"  ("expires_at") ');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_operations" ("scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "id" text COLLATE "C" NOT NULL, "run_id" text COLLATE "C" NOT NULL, "input_hash" text NOT NULL, "kind" text NOT NULL, "key" text COLLATE "C" NOT NULL, "removed" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_af30e6589f62e346f814c64cdde" PRIMARY KEY ("scope_id", "generation", "id"))');
        await queryRunner.query('CREATE INDEX "IDX_d962118bd5f7480e89f678bd32" ON "chamvi_conversation_operations"  ("scope_id", "created_at", "id") ');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" ADD CONSTRAINT "FK_8252e57feb07d3d5c100772ca68" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" ADD CONSTRAINT "FK_c2faa5ef0df1ac2535bb888e088" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" ADD CONSTRAINT "FK_94f96115d14b407087799db2081" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" DROP CONSTRAINT "FK_94f96115d14b407087799db2081"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" DROP CONSTRAINT "FK_c2faa5ef0df1ac2535bb888e088"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" DROP CONSTRAINT "FK_8252e57feb07d3d5c100772ca68"');
        await queryRunner.query('DROP INDEX "IDX_d962118bd5f7480e89f678bd32"');
        await queryRunner.query('DROP TABLE "chamvi_conversation_operations"');
        await queryRunner.query('DROP INDEX "IDX_cce05651783379a393713278e1"');
        await queryRunner.query('DROP TABLE "chamvi_conversation_notes"');
        await queryRunner.query('DROP INDEX "IDX_e33a156ff38559b5139e6a73ae"');
        await queryRunner.query('DROP INDEX "IDX_d53928fda61d11e44f785eb2a6"');
        await queryRunner.query('DROP TABLE "chamvi_conversation_items"');
        await queryRunner.query('DROP TABLE "chamvi_conversations"');
    }
}

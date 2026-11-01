/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ConversationsRunTaint1792713600000 implements MigrationInterface {
    name = 'ConversationsRunTaint1792713600000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('CREATE TABLE "chamvi_conversations" ("id" character varying(64) COLLATE "C" NOT NULL, "agent" text COLLATE "C" NOT NULL, "channel" text COLLATE "C" NOT NULL, "account" text COLLATE "C" NOT NULL, "chat" text COLLATE "C" NOT NULL, "audience" text COLLATE "C" NOT NULL, "generation" integer NOT NULL, "active_run_id" character varying(128), "snapshot_messages" jsonb, "snapshot_item_ids" text array, "snapshot_note_keys" text array, "snapshot_created_at" TIMESTAMP WITH TIME ZONE, "snapshot_omitted" integer, CONSTRAINT "PK_d70b087b46b044fb4d5ff1b20be" PRIMARY KEY ("id"))');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_items" ("seq" BIGSERIAL NOT NULL, "scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "id" text COLLATE "C" NOT NULL, "run_id" character varying(128) COLLATE "C" NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "role" text NOT NULL, "text" text NOT NULL, "status" text NOT NULL, "effect_key" text, "target_channel" text, "target_address" text, CONSTRAINT "PK_f777143245b3b360dfbe02a1bc1" PRIMARY KEY ("seq"))');
        await queryRunner.query('CREATE INDEX "IDX_d53928fda61d11e44f785eb2a6" ON "chamvi_conversation_items"  ("scope_id", "generation", "created_at", "seq") ');
        await queryRunner.query('CREATE UNIQUE INDEX "IDX_e33a156ff38559b5139e6a73ae" ON "chamvi_conversation_items"  ("scope_id", "generation", "id") ');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_notes" ("scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "key" text COLLATE "C" NOT NULL, "text" text NOT NULL, "run_id" character varying(128) COLLATE "C" NOT NULL, "tool_call_id" text NOT NULL, "step_index" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_ff451484f567e3a78070456dc53" PRIMARY KEY ("scope_id", "generation", "key"))');
        await queryRunner.query('CREATE INDEX "IDX_cce05651783379a393713278e1" ON "chamvi_conversation_notes"  ("expires_at") ');
        await queryRunner.query('CREATE TABLE "chamvi_conversation_operations" ("scope_id" character varying(64) COLLATE "C" NOT NULL, "generation" integer NOT NULL, "id" text COLLATE "C" NOT NULL, "run_id" character varying(128) COLLATE "C" NOT NULL, "input_hash" text NOT NULL, "kind" text NOT NULL, "key" text COLLATE "C" NOT NULL, "removed" boolean, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_af30e6589f62e346f814c64cdde" PRIMARY KEY ("scope_id", "generation", "id"))');
        await queryRunner.query('CREATE INDEX "IDX_d962118bd5f7480e89f678bd32" ON "chamvi_conversation_operations"  ("scope_id", "created_at", "id") ');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_scope_id" character varying(64)');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_generation" integer');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_agent" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_channel" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_account" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_chat" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_audience" text');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "conversation_text" text');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD "conversation_scope_id" character varying(64)');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD "conversation_generation" integer');
        await queryRunner.query('ALTER TABLE "chamvi_conversations" ADD CONSTRAINT "FK_ef8111d766fe466a3b307675e08" FOREIGN KEY ("active_run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD CONSTRAINT "FK_f52e3d9f9a700e00b7021682252" FOREIGN KEY ("conversation_scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        // Older stores allowed checkpoints and steps without runs. Keep those rows while enforcing new references.
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD CONSTRAINT "FK_4aac9035497a94deb8cdb39062e" FOREIGN KEY ("run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" ADD CONSTRAINT "FK_a7fd19281c5f361dc8473323752" FOREIGN KEY ("conversation_scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_steps" ADD CONSTRAINT "FK_ec83b59c000dc26e022836e98b7" FOREIGN KEY ("run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION NOT VALID');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" ADD CONSTRAINT "FK_8252e57feb07d3d5c100772ca68" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" ADD CONSTRAINT "FK_e3edf09ee4749bad2d7b394c830" FOREIGN KEY ("run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" ADD CONSTRAINT "FK_c2faa5ef0df1ac2535bb888e088" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" ADD CONSTRAINT "FK_08699555ad0212cc26e73325b75" FOREIGN KEY ("run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" ADD CONSTRAINT "FK_94f96115d14b407087799db2081" FOREIGN KEY ("scope_id") REFERENCES "chamvi_conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" ADD CONSTRAINT "FK_9490b26a059a1d8b50e8c1b0e25" FOREIGN KEY ("run_id") REFERENCES "chamvi_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION');
        await queryRunner.query('CREATE INDEX "IDX_f52e3d9f9a700e00b702168225" ON "chamvi_runs" ("conversation_scope_id") ');
        await queryRunner.query('CREATE INDEX "IDX_a7fd19281c5f361dc847332375" ON "chamvi_checkpoints" ("conversation_scope_id") ');
        await queryRunner.query('CREATE INDEX "IDX_e3edf09ee4749bad2d7b394c83" ON "chamvi_conversation_items" ("run_id") ');
        await queryRunner.query('CREATE INDEX "IDX_08699555ad0212cc26e73325b7" ON "chamvi_conversation_notes" ("run_id") ');
        await queryRunner.query('CREATE INDEX "IDX_9490b26a059a1d8b50e8c1b0e2" ON "chamvi_conversation_operations" ("run_id") ');
        await queryRunner.query('ALTER TABLE "chamvi_runs" ADD "taint" jsonb');
        // Resumable legacy runs may already contain untrusted checkpoint content.
        await queryRunner.query(`
            UPDATE "chamvi_runs"
            SET "taint" = jsonb_build_object('at', CURRENT_TIMESTAMP, 'source', 'migration:legacy-run')
            WHERE "status" IN ('queued', 'running', 'waiting', 'interrupted')
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "taint"');
        await queryRunner.query('DROP INDEX "IDX_9490b26a059a1d8b50e8c1b0e2"');
        await queryRunner.query('DROP INDEX "IDX_08699555ad0212cc26e73325b7"');
        await queryRunner.query('DROP INDEX "IDX_e3edf09ee4749bad2d7b394c83"');
        await queryRunner.query('DROP INDEX "IDX_a7fd19281c5f361dc847332375"');
        await queryRunner.query('DROP INDEX "IDX_f52e3d9f9a700e00b702168225"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" DROP CONSTRAINT "FK_9490b26a059a1d8b50e8c1b0e25"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_operations" DROP CONSTRAINT "FK_94f96115d14b407087799db2081"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" DROP CONSTRAINT "FK_08699555ad0212cc26e73325b75"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_notes" DROP CONSTRAINT "FK_c2faa5ef0df1ac2535bb888e088"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" DROP CONSTRAINT "FK_e3edf09ee4749bad2d7b394c830"');
        await queryRunner.query('ALTER TABLE "chamvi_conversation_items" DROP CONSTRAINT "FK_8252e57feb07d3d5c100772ca68"');
        await queryRunner.query('ALTER TABLE "chamvi_steps" DROP CONSTRAINT "FK_ec83b59c000dc26e022836e98b7"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP CONSTRAINT "FK_a7fd19281c5f361dc8473323752"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP CONSTRAINT "FK_4aac9035497a94deb8cdb39062e"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP CONSTRAINT "FK_f52e3d9f9a700e00b7021682252"');
        await queryRunner.query('ALTER TABLE "chamvi_conversations" DROP CONSTRAINT "FK_ef8111d766fe466a3b307675e08"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP COLUMN "conversation_generation"');
        await queryRunner.query('ALTER TABLE "chamvi_checkpoints" DROP COLUMN "conversation_scope_id"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_text"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_audience"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_chat"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_account"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_channel"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_agent"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_generation"');
        await queryRunner.query('ALTER TABLE "chamvi_runs" DROP COLUMN "conversation_scope_id"');
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

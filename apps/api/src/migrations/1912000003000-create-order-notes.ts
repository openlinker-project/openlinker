/**
 * Create `order_notes` + `order_note_revisions` (#3531)
 *
 * `order_notes.body` is blanked on soft-delete ("a deleted note leaves an
 * entry without its text"); `order_note_revisions` is the append-only
 * pre-edit capture that lets an edit's previous text survive being
 * overwritten.
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1912000002000-create-order-column-presets.ts`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderNotes1912000003000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "order_notes" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId"  uuid NOT NULL,
        "authorUserId"     uuid NOT NULL,
        "authorUsername"   text NOT NULL,
        "body"             text NOT NULL,
        "showToPacker"     boolean NOT NULL DEFAULT false,
        "editedAt"         TIMESTAMPTZ,
        "deletedAt"        TIMESTAMPTZ,
        "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_notes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_notes_internalOrderId" ON "order_notes" ("internalOrderId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_notes_showToPacker" ON "order_notes" ("showToPacker")
    `);

    await queryRunner.query(`
      CREATE TABLE "order_note_revisions" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "noteId"        uuid NOT NULL,
        "body"          text NOT NULL,
        "showToPacker"  boolean NOT NULL,
        "supersededAt"  TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_order_note_revisions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_order_note_revisions_noteId" ON "order_note_revisions" ("noteId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_note_revisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_notes"`);
  }
}

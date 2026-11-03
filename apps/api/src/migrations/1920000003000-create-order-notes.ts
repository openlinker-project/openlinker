/**
 * Create `order_notes` + `order_note_revisions` (#3531)
 *
 * `order_notes.body` is blanked on soft-delete ("a deleted note leaves an
 * entry without its text"); `order_note_revisions` is the append-only
 * pre-edit capture that lets an edit's previous text survive being
 * overwritten.
 *
 * `internalOrderId` is `text`, never `uuid` — an internal order id has the
 * shape `ol_order_{uuid}` (`docs/architecture-overview.md § Identifier
 * Mapping Service`), matching every other reference to it in this context
 * (`order_holds`, `order_changes`, `refund_records`).
 *
 * Timestamp: this epic's synthetic block (#3507), one step after
 * `1920000002000-create-order-column-presets.ts`.
 *
 * Renumbered from `1912000003000` (#3633 review — `main` took the `1912` prefix).
 * TypeORM decides pending by class name, so it re-runs this migration on any
 * database that applied it under its old name; every DDL statement is
 * therefore guarded with `IF NOT EXISTS` (`docs/migrations.md`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOrderNotes1920000003000 implements MigrationInterface {
  name = 'CreateOrderNotes1920000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_notes" (
        "id"               uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId"  text NOT NULL,
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
      CREATE INDEX IF NOT EXISTS "IDX_order_notes_internalOrderId" ON "order_notes" ("internalOrderId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_notes_showToPacker" ON "order_notes" ("showToPacker")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_note_revisions" (
        "id"            uuid NOT NULL DEFAULT uuid_generate_v4(),
        "noteId"        uuid NOT NULL,
        "body"          text NOT NULL,
        "showToPacker"  boolean NOT NULL,
        "supersededAt"  TIMESTAMPTZ NOT NULL,
        CONSTRAINT "PK_order_note_revisions" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_note_revisions_noteId" ON "order_note_revisions" ("noteId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_note_revisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "order_notes"`);
  }
}

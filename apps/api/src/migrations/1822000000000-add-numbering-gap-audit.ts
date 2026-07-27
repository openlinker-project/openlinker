/**
 * Numbering Gap-Audit Migration (#8)
 *
 * Adds the schema the numbering gap-audit read model needs:
 *
 *  - `invoice_records.allocatedSeq` (nullable integer) — the sequence integer a
 *    document consumed from its numbering series, persisted atomically with the
 *    rendered `documentNumber` so gaps are detectable BY INTEGER (a consumed seq
 *    whose record ended terminal-non-issued, or a skipped integer) rather than
 *    by parsing the rendered number. Additive + nullable → existing rows (a
 *    self-numbering provider, or pre-#8 allocations) stay `NULL`, which the audit
 *    reads as "no OL-allocated sequence". No backfill (no production usage yet,
 *    per #1527).
 *  - `invoice_number_gap_notes` — the persisted neutral written explanation of a
 *    numbering gap, one per `(seriesId, seq)` (a partial-free unique index). No
 *    FK to `invoice_numbering_series`: the note survives a detached series,
 *    mirroring the numbering-route detachable-pointer guarantee. Country-agnostic
 *    (ADR-026): `reason` is a free-text neutral string.
 *
 * Prefix `1822000000000` is strictly greater than the current migration tail
 * (`1821000000000`, per-document-type routing). Idempotent (`IF [NOT] EXISTS`);
 * `up()` + `down()`.
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNumberingGapAudit1822000000000 implements MigrationInterface {
  name = 'AddNumberingGapAudit1822000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    // 1. Consumed sequence integer on the invoice record.
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "allocatedSeq" integer`,
    );

    // 2. Gap explanations table.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_number_gap_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "seriesId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "documentNumber" text,
        "reason" text NOT NULL,
        "actorUserId" uuid,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_number_gap_notes" PRIMARY KEY ("id")
      )
    `);
    // At most one explanation per (series, sequence integer).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_number_gap_notes_series_seq"
        ON "invoice_number_gap_notes" ("seriesId", "seq")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_number_gap_notes_series_seq"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_number_gap_notes"`);
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "allocatedSeq"`,
    );
  }
}

/**
 * Add Invoice Numbering Series Migration (#1575)
 *
 * Creates the numbering-series aggregate (`invoice_numbering_series`) and the
 * detachable connection assignment (`invoice_numbering_assignments`), and adds
 * the numbering columns + last-line-of-defense unique indexes to
 * `invoice_records`. Country-agnostic (ADR-026): a series is a pattern, a
 * sequence, and a reset cadence — no provider/country vocabulary.
 *
 * The assignment's FKs to the series are `ON DELETE RESTRICT` so a series is
 * never cascade-deleted out from under an assignment; there is deliberately NO FK
 * to `connections`, so an assignment (and its series) survives connection
 * deletion. The two partial unique indexes on `invoice_records` reject a
 * re-rendered (rolled-back) document number in OpenLinker instead of at the
 * provider.
 *
 * Generated: 2026-07-15 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceNumberingSeries1820000000000 implements MigrationInterface {
  name = 'AddInvoiceNumberingSeries1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const seriesTable = await queryRunner.getTable('invoice_numbering_series');
    if (!seriesTable) {
      await queryRunner.query(`
        CREATE TABLE "invoice_numbering_series" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "name" text NOT NULL,
          "pattern" text NOT NULL,
          "nextSeq" integer NOT NULL,
          "seqPadding" integer NOT NULL DEFAULT 0,
          "resetPolicy" text NOT NULL,
          "periodKey" text NOT NULL DEFAULT '',
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_invoice_numbering_series" PRIMARY KEY ("id")
        )
      `);
    }

    const assignmentTable = await queryRunner.getTable('invoice_numbering_assignments');
    if (!assignmentTable) {
      await queryRunner.query(`
        CREATE TABLE "invoice_numbering_assignments" (
          "connectionId" uuid NOT NULL,
          "mainSeriesId" uuid NOT NULL,
          "correctionSeriesId" uuid,
          "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
          CONSTRAINT "PK_invoice_numbering_assignments" PRIMARY KEY ("connectionId"),
          CONSTRAINT "FK_invoice_numbering_assignments_main"
            FOREIGN KEY ("mainSeriesId") REFERENCES "invoice_numbering_series" ("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION,
          CONSTRAINT "FK_invoice_numbering_assignments_correction"
            FOREIGN KEY ("correctionSeriesId") REFERENCES "invoice_numbering_series" ("id")
            ON DELETE RESTRICT ON UPDATE NO ACTION
        )
      `);
    }

    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "numberingSeriesId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "documentNumber" text`,
    );

    // A rendered document number is unique within its series AND its connection.
    // Partial so the (common) null-number rows a self-numbering provider produces
    // never collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_records_series_document_number"
        ON "invoice_records" ("numberingSeriesId", "documentNumber")
        WHERE "documentNumber" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_records_connection_document_number"
        ON "invoice_records" ("connectionId", "documentNumber")
        WHERE "documentNumber" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_records_connection_document_number"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_records_series_document_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "documentNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "numberingSeriesId"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_numbering_assignments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_numbering_series"`);
  }
}

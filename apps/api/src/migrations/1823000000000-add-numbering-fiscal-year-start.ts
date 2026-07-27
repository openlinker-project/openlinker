/**
 * Add Numbering Fiscal-Year Start Migration (#1692)
 *
 * Adds the `fiscalYearStartMonth` column to `invoice_numbering_series` — the
 * calendar month (1-12) a series' fiscal year starts on, governing the `{FY}`
 * pattern variable. Defaults to `1` (January) so `{FY}` renders identically to
 * `{YYYY}` and every pre-#1692 series is unchanged. Country-agnostic (ADR-026):
 * a positional pattern concern, no provider/country vocabulary.
 *
 * The daily reset policy shipped in the same change needs NO schema migration —
 * `resetPolicy` is a free-text column and `daily` is just a new accepted value.
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNumberingFiscalYearStart1823000000000 implements MigrationInterface {
  name = 'AddNumberingFiscalYearStart1823000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" ` +
        `ADD COLUMN IF NOT EXISTS "fiscalYearStartMonth" integer NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_series" DROP COLUMN IF EXISTS "fiscalYearStartMonth"`,
    );
  }
}

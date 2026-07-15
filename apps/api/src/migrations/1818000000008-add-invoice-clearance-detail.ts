/**
 * Add Invoice Clearance Detail Migration
 *
 * Adds the nullable `clearanceDetail` text column to `invoice_records` (#1582).
 * It carries the authority's operator-facing rejection diagnostic (the KSeF
 * `description`/`details` on a rejected clearance read) so the invoice detail
 * page can explain WHY a document was rejected, not merely that it was.
 * Country-agnostic (ADR-026): an opaque free-text blob the adapter fills from
 * its regime's rejection fields, never interpreted in core. Nullable with no
 * default - existing rows and non-rejection reads simply carry NULL.
 *
 * Generated: 2026-07-15 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceClearanceDetail1818000000008 implements MigrationInterface {
  name = 'AddInvoiceClearanceDetail1818000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "clearanceDetail" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "clearanceDetail"`,
    );
  }
}

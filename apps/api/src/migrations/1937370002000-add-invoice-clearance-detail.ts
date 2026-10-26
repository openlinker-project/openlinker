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
 * Renumbered twice while this branch was unmerged: from 1818000000008 (taken on
 * `main` by add-email-confirmation-tokens) and from 1921000000000 (it must sort
 * after main's newest migration). A shared prefix leaves the apply order
 * undefined and `check-migration-timestamps` refuses it.
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceClearanceDetail1937370002000 implements MigrationInterface {
  name = 'AddInvoiceClearanceDetail1937370002000';

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

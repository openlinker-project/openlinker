/**
 * Add Invoice Issued Line Snapshot Migration
 *
 * Adds the nullable `issuedLineSnapshot` jsonb column to `invoice_records` — the
 * neutral issuance-time line snapshot (#1297) capturing `{ buyer, currency,
 * lines }` exactly as issued, so a later correction (KSeF FA(3) KOR, or any
 * complete-resubmit correction) diffs its `originalLineNumber`-indexed deltas
 * against the lines AS ISSUED rather than the order's current (possibly-edited)
 * state. Country-agnostic (ADR-026): the JSON reuses the neutral BuyerProfile +
 * InvoiceLine shapes; no regime/provider vocabulary. Nullable so rows issued
 * before this column (and any issue path that captures no snapshot) carry NULL
 * and fall back to order-derived reconstruction rather than blocking.
 *
 * Generated: 2026-07-02 (synthetic sequential prefix per docs/migrations.md #1013;
 * strictly greater than the W3 `1818000000002` source-document migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceIssuedLineSnapshot1818000000003 implements MigrationInterface {
  name = 'AddInvoiceIssuedLineSnapshot1818000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "issuedLineSnapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "issuedLineSnapshot"`,
    );
  }
}

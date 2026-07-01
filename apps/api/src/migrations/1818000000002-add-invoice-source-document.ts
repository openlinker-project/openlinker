/**
 * Add Invoice Source Document Migration
 *
 * Adds the nullable `sourceDocument` jsonb column to `invoice_records` — the
 * neutral persisted machine-readable source document (PL/KSeF: the FA(3) XML,
 * #1224 W3) captured at issue time and re-served by
 * `GET /invoices/:invoiceId/document?kind=source`. Country-agnostic (ADR-026):
 * the JSON carries only a provider-reported MIME type + base64 bytes; no
 * regime/provider vocabulary. Nullable so existing rows (and providers that
 * surface no source document) carry NULL rather than blocking.
 *
 * Generated: 2026-06-26 (synthetic sequential prefix per docs/migrations.md #1013;
 * strictly greater than the W2 `1818000000001` document-content migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceSourceDocument1818000000002 implements MigrationInterface {
  name = 'AddInvoiceSourceDocument1818000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "sourceDocument" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "sourceDocument"`,
    );
  }
}

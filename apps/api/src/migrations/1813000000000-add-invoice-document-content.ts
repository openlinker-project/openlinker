/**
 * Add Invoice Document Content Migration
 *
 * Adds the nullable `documentContent` jsonb column to `invoice_records` — the
 * neutral issued-document content snapshot (§7.3, #1224 W2) captured at issue
 * time and read by `GET /invoices/:invoiceId/content`. Country-agnostic
 * (ADR-026): the JSON carries only scheme-tagged tax ids + neutral tax-rate
 * codes; no regime/provider vocabulary. Nullable so existing rows (and providers
 * that surface no content) carry NULL rather than blocking.
 *
 * Generated: 2026-06-26 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceDocumentContent1813000000000 implements MigrationInterface {
  name = 'AddInvoiceDocumentContent1813000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "documentContent" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "documentContent"`,
    );
  }
}

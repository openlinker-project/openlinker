/**
 * Create Invoice Marketplace Uploads Migration
 *
 * Creates `invoice_marketplace_uploads` (#3549): whether an issued sales
 * document reached the marketplace order it was issued for, one row per
 * `(invoiceRecordId, targetConnectionId)`. The unique index IS the at-most-once
 * attempt claim.
 *
 * No foreign keys - both ids are cross-aggregate references by value (the
 * `order_changes` / `refund_records` precedent), so the upload history outlives
 * a deleted connection or invoice rather than cascading away with it. `status`
 * is plain text with no CHECK: the integration harness builds schema by
 * `synchronize`, which emits none, so a constraint present only here would hold
 * in production and silently not in tests.
 *
 * Generated: 2026-10-27 (synthetic sequential prefix per docs/migrations.md #1013,
 * sorted after main's newest migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceMarketplaceUploads1937450000000 implements MigrationInterface {
  name = 'CreateInvoiceMarketplaceUploads1937450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "invoice_marketplace_uploads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "invoiceRecordId" uuid NOT NULL,
        "targetConnectionId" uuid NOT NULL,
        "status" text NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastFailureCode" text,
        "uploadedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_marketplace_uploads" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_marketplace_uploads_invoice_target"
      ON "invoice_marketplace_uploads" ("invoiceRecordId", "targetConnectionId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_invoice_marketplace_uploads_invoice_target"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_marketplace_uploads"`);
  }
}

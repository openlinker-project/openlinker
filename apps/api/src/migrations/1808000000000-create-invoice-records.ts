/**
 * Create Invoice Records Table Migration
 *
 * Creates the `invoice_records` table — OL's non-authoritative projection of
 * fiscal documents issued through a provider for an order on an invoicing
 * connection (#751, ADR-026). Country-agnostic columns; `regulatoryStatus` /
 * `clearanceReference` are nullable-with-default and unused until a future
 * `RegulatoryTransmitter` adapter (KSeF/SDI/…) populates them. The partial
 * UNIQUE index on `(connectionId, idempotencyKey)` is the durable exactly-once
 * issuance guard.
 *
 * Generated: 2026-06-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInvoiceRecords1808000000000 implements MigrationInterface {
  name = 'CreateInvoiceRecords1808000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const table = await queryRunner.getTable('invoice_records');
    if (table) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE "invoice_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId" uuid NOT NULL,
        "orderId" text NOT NULL,
        "providerType" text NOT NULL,
        "documentType" text NOT NULL,
        "status" text NOT NULL,
        "providerInvoiceId" text,
        "providerInvoiceNumber" text,
        "regulatoryStatus" text NOT NULL DEFAULT 'not-applicable',
        "clearanceReference" text,
        "idempotencyKey" text,
        "pdfUrl" text,
        "issuedAt" TIMESTAMP,
        "errorMessage" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_invoice_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_records_order_connection"
        ON "invoice_records" ("orderId", "connectionId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_records_connectionId"
        ON "invoice_records" ("connectionId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_records_status"
        ON "invoice_records" ("status")
    `);

    // Lookup of an issued document by provider id (transmission / reconcile).
    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_records_provider_invoice_id"
        ON "invoice_records" ("providerInvoiceId")
        WHERE "providerInvoiceId" IS NOT NULL
    `);

    // Fiscal-dedup guard: exactly-once issuance on retry. Partial so rows
    // without a key (manual one-off issues) don't collide on NULL.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_invoice_records_connection_idempotency"
        ON "invoice_records" ("connectionId", "idempotencyKey")
        WHERE "idempotencyKey" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_records_connection_idempotency"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_invoice_records_provider_invoice_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_records_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_records_connectionId"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_records_order_connection"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "invoice_records"`);
  }
}

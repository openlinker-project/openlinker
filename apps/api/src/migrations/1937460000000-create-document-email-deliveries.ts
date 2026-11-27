/**
 * Create Document Email Deliveries Migration
 *
 * #3550: one row per manual attempt to email a sales document to the buyer, so
 * the order timeline can show "Invoice emailed to buyer" / "Email to buyer
 * failed". Append-only. No foreign keys (`internalOrderId` / `documentId` are
 * references by value, so the record outlives what it was about) and no PG enum
 * or CHECK on a vocabulary column (the integration harness builds schema by
 * `synchronize`, which emits neither).
 *
 * Generated: 2026-10-28 (synthetic sequential prefix per docs/migrations.md #1013,
 * sorted after the stack's newest migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDocumentEmailDeliveries1937460000000 implements MigrationInterface {
  name = 'CreateDocumentEmailDeliveries1937460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "document_email_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId" text NOT NULL,
        "documentKind" character varying(64) NOT NULL,
        "documentId" text NOT NULL,
        "sentVia" character varying(16),
        "outcome" character varying(16) NOT NULL,
        "failureReason" character varying(64),
        "recipient" text,
        "actorUserId" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_document_email_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_document_email_deliveries_order_created" ON "document_email_deliveries" ("internalOrderId", "createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_document_email_deliveries_order_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "document_email_deliveries"`);
  }
}

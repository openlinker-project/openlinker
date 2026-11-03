/**
 * Create Buyer Email Deliveries Migration
 *
 * #3554: one row per automatic buyer email attempt (order confirmed, shipped,
 * document issued, return received) that reached a decision - sent, suppressed
 * with a reason, or bounced - so the order timeline can say what the buyer got.
 * A send first takes a `pending` claim under a partial unique index on the
 * subject, so two concurrent firings cannot both email the buyer.
 * No foreign keys (`internalOrderId` / `connectionId` are references by value)
 * and no PG enum or CHECK on a vocabulary column (the integration harness builds
 * schema by `synchronize`, which emits neither).
 *
 * Generated: 2026-10-29 (synthetic sequential prefix per docs/migrations.md #1013,
 * sorted after the stack's newest migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBuyerEmailDeliveries1937470000000 implements MigrationInterface {
  name = 'CreateBuyerEmailDeliveries1937470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "buyer_email_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId" text NOT NULL,
        "connectionId" text NOT NULL,
        "templateKey" character varying(64) NOT NULL,
        "subjectRef" text NOT NULL,
        "outcome" character varying(16) NOT NULL,
        "suppressionReason" character varying(64),
        "recipient" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_buyer_email_deliveries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_buyer_email_deliveries_order_created" ON "buyer_email_deliveries" ("internalOrderId", "createdAt")`
    );
    // The at-most-once send slot: a `pending` claim or a `sent` row per subject.
    // Partial, so a suppressed or bounced row never blocks a later send.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_buyer_email_deliveries_subject_claim" ON "buyer_email_deliveries" ("internalOrderId", "templateKey", "subjectRef") WHERE "outcome" IN ('pending', 'sent')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_buyer_email_deliveries_subject_claim"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_buyer_email_deliveries_order_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "buyer_email_deliveries"`);
  }
}

/**
 * Create Refund Records Table Migration
 *
 * Creates the `refund_records` table — capture-only record of a
 * return/refund/withdrawal against an order (#2036). No FK to
 * `order_records.internalOrderId` (plain indexed `text` column, matching the
 * `invoice_records.orderId` precedent) — existence of the order is verified
 * at the application layer, not enforced at the DB layer, avoiding
 * cross-table lock coupling. `amount` is `numeric(12,2)` (not `text`) so a
 * malformed value can never reach the table regardless of caller — matches
 * the `RefundRecordOrmEntity` shape. The partial unique index on
 * `(internalOrderId, idempotencyKey)` mirrors `invoice_records`'
 * `(connectionId, idempotencyKey)` dedup guard, retry-safe for a retried
 * manual write.
 *
 * Generated: 2026-08-12 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRefundRecords1833000000000 implements MigrationInterface {
  name = 'CreateRefundRecords1833000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const table = await queryRunner.getTable('refund_records');
    if (table) {
      return;
    }

    await queryRunner.query(`
      CREATE TABLE "refund_records" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "internalOrderId" text NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "currency" character varying(3) NOT NULL,
        "reason" text NOT NULL,
        "note" text,
        "recordedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "idempotencyKey" text,
        CONSTRAINT "PK_refund_records" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_refund_records_internal_order_id"
        ON "refund_records" ("internalOrderId")
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_refund_records_order_idempotency"
        ON "refund_records" ("internalOrderId", "idempotencyKey")
        WHERE "idempotencyKey" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."UQ_refund_records_order_idempotency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_refund_records_internal_order_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "refund_records"`);
  }
}

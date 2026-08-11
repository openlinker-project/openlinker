/**
 * Add OrderRecord cancelledAt Migration
 *
 * Adds `cancelledAt` (nullable timestamptz) to `order_records` (#1984) —
 * durably records the instant the source reported an order cancelled,
 * independent of `recordStatus` (which tracks item-mapping resolution, not
 * business status — an order can be `ready` and cancelled at once).
 *
 * Backfill: for existing rows where the raw snapshot's `status` key already
 * reads 'cancelled' (the same top-level key on both the pre-mapping
 * IncomingOrder shape and the resolved Order shape), sets
 * `cancelledAt := "updatedAt"` as a best-effort proxy for "the last time we
 * observed this order's cancelled state" — NOT the true cancellation instant,
 * which cannot be reconstructed from data OL already holds. Rows whose
 * snapshot does not report 'cancelled' are left NULL (never cancelled).
 * Idempotent: `WHERE "cancelledAt" IS NULL` makes re-running this migration
 * (or a from-scratch replay) a no-op on rows already backfilled.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordCancelledAt1832000000008 implements MigrationInterface {
  name = 'AddOrderRecordCancelledAt1832000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "cancelledAt" timestamptz`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_cancelledAt" ON "order_records" ("cancelledAt")`,
    );
    await queryRunner.query(
      `UPDATE "order_records"
       SET "cancelledAt" = "updatedAt"
       WHERE "cancelledAt" IS NULL
         AND "orderSnapshot"->>'status' = 'cancelled'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_cancelledAt"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "cancelledAt"`);
  }
}

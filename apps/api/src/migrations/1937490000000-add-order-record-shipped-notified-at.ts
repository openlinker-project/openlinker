/**
 * Add Order Record Shipped-Notified-At Migration
 *
 * #3554: `order_records.shippedNotifiedAt` is the at-most-once claim for the
 * `order.shipped` trigger. It used to ride the `fulfillmentState` transition,
 * which fired the moment an order turned dispatched - before a carrier such as
 * InPost had minted the tracking number, so the buyer's "your order shipped"
 * email read "Tracking number: not yet" with no second email to correct it.
 * The trigger now waits for the number, so "entered shipped" and "announced
 * shipped" become two moments and need their own column.
 *
 * Every order already in a shipped state is stamped: under the old rule its
 * transition already fired `order.shipped`, and a NULL here would let a later
 * tracking backfill announce it a second time.
 *
 * Generated: 2026-11-02 (synthetic sequential prefix per docs/migrations.md #1013,
 * sorted after the stack's newest migration).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordShippedNotifiedAt1937490000000 implements MigrationInterface {
  name = 'AddOrderRecordShippedNotifiedAt1937490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "shippedNotifiedAt" TIMESTAMP WITH TIME ZONE NULL`
    );
    await queryRunner.query(
      `UPDATE "order_records" SET "shippedNotifiedAt" = "updatedAt"
         WHERE "shippedNotifiedAt" IS NULL AND "fulfillmentState" IN ('dispatched', 'delivered')`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "shippedNotifiedAt"`);
  }
}

/**
 * Add the per-parcel buyer-note acknowledgement to `fulfillment_works`
 * (#3538, decision D12).
 *
 * The buyer note belongs to the ORDER and shows on every parcel of a split
 * order; each parcel is acknowledged separately at the pack bench, so who/when
 * lives on the `FulfillmentWork`. Fill-once (`WHERE ... IS NULL`), no version
 * bump, like `invoicePrintedAt`. Both columns nullable, no backfill.
 *
 * Generated: 2026-10-26 (synthetic sequential prefix per docs/migrations.md).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkBuyerNoteAcknowledgement1938100002000
  implements MigrationInterface
{
  name = 'AddFulfillmentWorkBuyerNoteAcknowledgement1938100002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "buyerNoteAcknowledgedAt" timestamptz`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "buyerNoteAcknowledgedByUserId" varchar`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "buyerNoteAcknowledgedByUserId"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "buyerNoteAcknowledgedAt"`
    );
  }
}

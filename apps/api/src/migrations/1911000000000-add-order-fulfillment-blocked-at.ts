/**
 * Add `order_records.fulfillmentBlockedAt` (#3485 review, epic #3460).
 *
 * When the current fulfilment HOLD began. `fulfillment.work.rerouteSweep` bounds
 * how often it re-drives a still-held order by how long it has actually been
 * held; measuring from `createdAt` (ingestion) instead denies the fast window to
 * every pre-existing order the moment an operator adopts the OMS, and error-logs
 * a first-ever refusal as a two-week-old failure.
 *
 * Stamped only on none -> held (the `salesDocumentBlockedAt` rule), so it
 * survives a change of reason and keeps measuring the same episode. Nullable
 * with no default and NO backfill: a row held before this column existed reads
 * as "not asserted", which the sweep treats as ineligible for the stuck log
 * rather than instantly stuck.
 *
 * Generated: 2026-09-29 (synthetic sequential prefix per docs/migrations.md
 * rule 3; above 1907000000000 and clear of the 1912/1913 series in flight).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderFulfillmentBlockedAt1911000000000 implements MigrationInterface {
  name = 'AddOrderFulfillmentBlockedAt1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fulfillmentBlockedAt" timestamptz`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fulfillmentBlockedAt"`
    );
  }
}

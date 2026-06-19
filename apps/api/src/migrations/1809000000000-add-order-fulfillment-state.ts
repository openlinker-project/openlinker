/**
 * Add order_records.fulfillmentState + index (#1108)
 *
 * Persists a per-order fulfillment rollup (`not-shipped | dispatched |
 * delivered | failed`) denormalized from the shipping context's `Shipment`
 * rows, so the orders list can show "has this shipped?" and filter/sort on it
 * without a cross-context query. Pushed from shipping via
 * `IOrderRecordService.updateFulfillmentState`.
 *
 * Additive + nullable → backward-compatible: existing rows get NULL, treated as
 * `not-shipped` by every derivation/filter/summary (no backfill — orders with
 * prior shipments converge on the next shipment mutation or the reconciliation
 * poll). `down()` drops the index then the column.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderFulfillmentState1809000000000 implements MigrationInterface {
  name = 'AddOrderFulfillmentState1809000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" ADD "fulfillmentState" character varying`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_fulfillmentState" ON "order_records" ("fulfillmentState")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_order_records_fulfillmentState"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "fulfillmentState"`);
  }
}

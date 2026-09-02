/**
 * Add `shipments.direction` and widen the branch-1 duplicate guard (#2373).
 *
 * ADR-060 recorded this as a carried-forward consequence of returns landing in
 * Wave 1c: a return label is a shipment, but `UQ_shipments_branch_one_per_order_conn`
 * could hold only ONE waybill-less row per `(orderId, connectionId)`, so an
 * outbound shipment and a return label for the same order could not coexist.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentDirection1862000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // The default backfills history and is then dropped in the same statement
    // block. `'outbound'` is a true statement about every existing row, not a
    // placeholder: `shipments` rows are written by `ShipmentDispatchService`
    // (an operator buying a label for goods going to a buyer) or by
    // `FulfillmentStatusSyncService`'s branch-1 projection (a marketplace
    // reporting the seller shipped). No code path in the tree has ever been
    // able to create a return label, so no existing row can be one.
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "direction" text NOT NULL DEFAULT 'outbound'`,
    );

    // Dropping the default is the point of the two-step. Left in place,
    // TypeORM's schema sync would keep re-adding it and `direction` would be
    // unstated-but-present on every future insert.
    await queryRunner.query(`ALTER TABLE "shipments" ALTER COLUMN "direction" DROP DEFAULT`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_shipments_branch_one_per_order_conn"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shipments_branch_one_per_order_conn" ` +
        `ON "shipments" ("orderId", "connectionId", "direction") ` +
        `WHERE "providerShipmentId" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // WARNING — this rollback is conditionally destructive once return labels
    // exist. Recreating the two-column index fails with a duplicate-key error
    // on any `(orderId, connectionId)` holding BOTH an outbound and a return
    // branch-1 row. That is unreachable today (nothing in the tree writes
    // `direction = 'return'`), which is exactly why it is written down here:
    // the first slice that buys a return label makes this `down()` unsafe, and
    // it will need a documented data step before it can run.
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_shipments_branch_one_per_order_conn"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shipments_branch_one_per_order_conn" ` +
        `ON "shipments" ("orderId", "connectionId") ` +
        `WHERE "providerShipmentId" IS NULL`,
    );
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "direction"`);
  }
}

/**
 * Add Branch-1 Shipments Unique Index Migration
 *
 * Adds the partial-unique index `UQ_shipments_branch_one_per_order_conn`
 * on `shipments(orderId, connectionId) WHERE providerShipmentId IS NULL` —
 * the DB-side dedup gate for branch-1 (OMP-fulfilled) shipment projection
 * rows (#834, ADR-012).
 *
 * Branch-1 rows carry `providerShipmentId IS NULL`; branches 2/3 carry a
 * non-null provider id and are already guarded by
 * `UQ_shipments_providerShipmentId`. The two indexes are disjoint by
 * construction — every row matches exactly one (or neither, during the
 * tiny draft window of branch-2/3 dispatch).
 *
 * @see {@link FulfillmentStatusSyncService} for the find-then-create gate
 *   this index backstops against concurrent ticks.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBranchOneShipmentsUqIndex1799000000007 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // `IF NOT EXISTS` makes the migration idempotent — re-running it on a
    // database that already has the index (e.g. after the integration-test
    // synchronize path has run, or after a manual hot-fix) is a no-op.
    // Trade-off: if a pre-existing index with the same NAME but a
    // different `WHERE` clause exists, Postgres silently keeps the
    // existing one instead of replacing it (a different name would surface
    // the drift loudly via a duplicate-name error). Acceptable for
    // OpenLinker's deploy model where prod schema is always migration-driven
    // — the only way the shadowing risk materialises is a manual `psql`
    // edit, which would be a process issue independent of this migration.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_shipments_branch_one_per_order_conn"
        ON "shipments" ("orderId", "connectionId")
        WHERE "providerShipmentId" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_shipments_branch_one_per_order_conn"
    `);
  }
}

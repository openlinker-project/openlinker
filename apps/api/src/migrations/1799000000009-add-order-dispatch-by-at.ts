/**
 * Add order_records.dispatchByAt + index (#927)
 *
 * Persists the derived marketplace dispatch (ship-by) deadline — the `.to` of
 * the source dispatch window (Allegro `delivery.time.dispatch`) — denormalized
 * from the JSONB snapshot to a top-level, indexed column so the orders list can
 * sort by SLA and filter "breaching / overdue" without parsing JSONB per row.
 *
 * Additive + nullable → backward-compatible: existing rows get NULL (no
 * dispatch SLA known) and degrade gracefully (no countdown). Re-derived on
 * every persist, so a re-pulled order with a changed window updates it.
 * `down()` drops the index then the column.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderDispatchByAt1799000000009 implements MigrationInterface {
  name = 'AddOrderDispatchByAt1799000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" ADD "dispatchByAt" TIMESTAMP WITH TIME ZONE`);
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_dispatchByAt" ON "order_records" ("dispatchByAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_order_records_dispatchByAt"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN "dispatchByAt"`);
  }
}

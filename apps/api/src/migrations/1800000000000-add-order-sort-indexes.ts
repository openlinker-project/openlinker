/**
 * Add Order Sort Indexes
 *
 * Expression indexes backing the server-side sortable columns on the /orders
 * list (#944): total (numeric), item count, and customer last name are derived
 * from the `orderSnapshot` JSONB, so a plain column index can't cover them.
 * The `status` sort uses a bounded health `CASE` (cheap, no index). `createdAt`
 * / `dispatchByAt` already have B-tree indexes from earlier migrations.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderSortIndexes1800000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_snapshot_total" ON "order_records" ` +
        `((CASE WHEN jsonb_typeof("orderSnapshot"#>'{totals,total}') = 'number' ` +
        `THEN ("orderSnapshot"#>>'{totals,total}')::numeric END))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_snapshot_customer" ON "order_records" ` +
        `((lower("orderSnapshot"#>>'{shippingAddress,lastName}')))`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_order_records_snapshot_items" ON "order_records" ` +
        `((CASE WHEN jsonb_typeof("orderSnapshot"->'items') = 'array' ` +
        `THEN jsonb_array_length("orderSnapshot"->'items') END))`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_snapshot_items"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_snapshot_customer"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_snapshot_total"`);
  }
}

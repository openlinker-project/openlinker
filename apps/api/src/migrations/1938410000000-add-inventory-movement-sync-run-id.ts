/**
 * Add inventory_movements.syncRunId (#4062)
 *
 * Names the sync run that wrote a stock movement: a sweep cycle id, or the
 * job id of a single-product sync. The stock history uses it to group one
 * run's rows exactly instead of guessing by connection and minute.
 *
 * Nullable with no backfill: rows written before this column existed, and
 * every row written outside a sync (sales, corrections, restocks), carry no
 * run. Nothing needs an index on it yet, since rows are grouped on the page
 * that is already read, never looked up by run.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryMovementSyncRunId1938410000000 implements MigrationInterface {
  name = 'AddInventoryMovementSyncRunId1938410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "syncRunId" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_movements" DROP COLUMN IF EXISTS "syncRunId"`);
  }
}

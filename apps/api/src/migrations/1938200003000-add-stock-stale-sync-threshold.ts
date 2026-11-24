/**
 * Add `stock_stale_sync_threshold_hours` (#3621)
 *
 * Nullable Operational Settings column: hours a stock observation may age
 * before the stock view flags it stale. `NULL` means "not set, fall through to
 * `OL_STOCK_STALE_SYNC_THRESHOLD_HOURS`, then to the code default (6)", so an
 * install that never opens the settings page behaves as before.
 *
 * Hand-authored like the table's other migrations (`migration:generate` would
 * re-emit the sibling `timestamptz` column as `timestamp without time zone`).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStockStaleSyncThreshold1938200003000 implements MigrationInterface {
  name = 'AddStockStaleSyncThreshold1938200003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "stock_stale_sync_threshold_hours" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "stock_stale_sync_threshold_hours"`
    );
  }
}

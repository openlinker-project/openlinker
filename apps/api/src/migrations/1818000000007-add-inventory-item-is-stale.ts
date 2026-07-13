/**
 * Add Inventory Item isStale Migration
 *
 * Adds the `isStale` boolean column to `inventory_items` (#1478). The master
 * inventory sync soft-marks a row as stale when its variant stops appearing in
 * the master's `listInventory` response (variant deleted at the master), rather
 * than hard-deleting it — so debugging history is preserved. Stale rows are
 * excluded from the variant-availability read the offer flows act on. Defaults
 * `false` so all existing rows backfill to "live".
 *
 * Column name is camelCase (`isStale`) to match TypeORM's default naming — the
 * repo sets no naming strategy, so ORM property names are the column names
 * (cf. `availableQuantity`, `productVariantId`, `paymentStatus`).
 *
 * Generated: 2026-07-12 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryItemIsStale1818000000007 implements MigrationInterface {
  name = 'AddInventoryItemIsStale1818000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "isStale" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "isStale"`,
    );
  }
}

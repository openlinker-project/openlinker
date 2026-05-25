/**
 * Clean up product-level inventory rows for multi-variant products (#823)
 *
 * #822 made master inventory variant-keyed for single-variant products and
 * backfilled their rows; multi-variant products were left product-level
 * (`productVariantId = NULL`). From #823 the master sync writes one
 * variant-keyed row per combination, so those legacy product-level aggregate
 * rows are orphans — invisible to the variant-keyed availability read (they
 * already read 0 by variant) and superseded by the per-combination rows the
 * next sync writes. This migration deletes them so no orphan remains (AC).
 *
 * Scope: only products with **more than one** variant. Single-variant products
 * were already converted in place by #822 and keep their variant-keyed row.
 *
 * Data-only migration — no schema change.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CleanupMultivariantProductLevelInventory1799000000004 implements MigrationInterface {
  name = 'CleanupMultivariantProductLevelInventory1799000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "inventory_items"
      WHERE "productVariantId" IS NULL
        AND "productId" IN (
          SELECT "productId"
          FROM "product_variants"
          GROUP BY "productId"
          HAVING COUNT(*) > 1
        )
    `);
  }

  public async down(): Promise<void> {
    // No-op: the deleted rows were product-level aggregates with no per-variant
    // breakdown, so they can't be reconstructed here. The next master-inventory
    // sync repopulates the affected products with per-combination variant-keyed
    // rows, so a revert leaves multi-variant products at the same "read 0 by
    // variant" state they were in before #823 — no data is lost that the sync
    // can't re-derive.
  }
}

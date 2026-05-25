/**
 * Backfill inventory_items.productVariantId for single-variant products (#822)
 *
 * Master inventory historically landed product-level (`productVariantId = NULL`)
 * while the canonical mapping/offer target — and the availability read used by
 * the bulk offer wizard — is the variant. From #822 the sync writes
 * variant-keyed rows; this migration converts the *existing* product-level rows
 * in place so the variant-keyed read finds them.
 *
 * Scope: only products with **exactly one** variant (a simple product's
 * deterministic synthetic variant). Multi-variant products can't have a single
 * product-level aggregate split across variants here — they stay product-level
 * pending per-combination support (#823 master / #824 Allegro destination).
 *
 * In place (no INSERT): converting the row rather than inserting a variant-keyed
 * one avoids leaving an orphan product-level duplicate that a subsequent
 * variant-keyed sync would otherwise create (the two partial unique indexes on
 * inventory_items permit both a NULL-variant and a variant row for the same
 * product). The `NOT EXISTS` guard keeps the UPDATE safe if any variant-keyed
 * row already exists.
 *
 * Data-only migration — no schema change (the `productVariantId` column and both
 * partial unique indexes already exist).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillInventoryVariantId1799000000003 implements MigrationInterface {
  name = 'BackfillInventoryVariantId1799000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "inventory_items" i
      SET "productVariantId" = sub.variant_id
      FROM (
        SELECT v."productId" AS product_id, MIN(v."id") AS variant_id
        FROM "product_variants" v
        GROUP BY v."productId"
        HAVING COUNT(*) = 1
      ) sub
      WHERE i."productId" = sub.product_id
        AND i."productVariantId" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "inventory_items" i2
          WHERE i2."productId" = i."productId"
            AND i2."productVariantId" = sub.variant_id
            AND i2."locationId" IS NOT DISTINCT FROM i."locationId"
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert single-variant rows back to product-level. Inherently lossy: a
    // data-migration down() cannot distinguish rows this migration converted
    // from rows that were already variant-keyed beforehand (none existed at
    // up() time, so this is exact for that case). Scoped with the same
    // single-variant predicate as up() to minimise over-reach.
    await queryRunner.query(`
      UPDATE "inventory_items" i
      SET "productVariantId" = NULL
      FROM (
        SELECT v."productId" AS product_id, MIN(v."id") AS variant_id
        FROM "product_variants" v
        GROUP BY v."productId"
        HAVING COUNT(*) = 1
      ) sub
      WHERE i."productId" = sub.product_id
        AND i."productVariantId" = sub.variant_id
    `);
  }
}

/**
 * Add Price To Product Variants
 *
 * Adds a `price` column to the `product_variants` table so the per-variant
 * master price extracted by the master adapter (today: PrestaShop combination
 * `price` and the synthetic-variant fallback to parent-product `price`)
 * survives persistence and round-trips through the products read API.
 *
 * Unblocks #792 PR 1: the bulk-listing wizard needs `variant.price` on the
 * wire to compute per-row resolved prices under the new master-pull + batch
 * policy model. Today the master adapters extract the value but it is silently
 * dropped at the persistence layer because no column exists.
 *
 * Decimal precision matches the existing `products.price` column
 * (`decimal(10,2)`) for consistency. Nullable — existing variants stay null
 * until their next sync populates the field; the FE surfaces `null` as a
 * `no-master-price` blocker in the wizard's status model.
 *
 * No historical backfill — natural sync churn populates the field over time.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceToProductVariants1799000000001 implements MigrationInterface {
  name = 'AddPriceToProductVariants1799000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "price" numeric(10,2)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "price"`);
  }
}

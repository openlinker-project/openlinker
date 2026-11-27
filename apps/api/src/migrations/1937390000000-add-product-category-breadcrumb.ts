/**
 * Add Product Category Breadcrumb
 *
 * Adds a nullable `categoryBreadcrumb` JSONB column to `products`: the master's
 * own category path (root to leaf, `{ id, name }[]`) carried on
 * `Product.categoryBreadcrumb`. The product sync already read it from the shop
 * and dropped it on persist, so the product page could show only bare category
 * ids or nothing. Existing rows get `NULL`; the column fills on the next product
 * sync, so no backfill is needed.
 *
 * Mirrors the nullable `features` / `categories` JSONB columns.
 * `IF NOT EXISTS` / `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductCategoryBreadcrumb1937390000000 implements MigrationInterface {
  name = 'AddProductCategoryBreadcrumb1937390000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "categoryBreadcrumb" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "categoryBreadcrumb"`);
  }
}

/**
 * Add Product Categories (#1034 / ADR-023 §0)
 *
 * Adds a nullable `categories` JSONB column to `products` — the source-platform
 * external category ids carried on `Product.categories`. Phase 0 of the
 * cross-platform-listing epic (#1005): until now the master product sync
 * dropped these ids on persist (no column), leaving per-source-category mapping
 * with no input. Existing rows get `NULL`; the column repopulates on the next
 * product sync, so no backfill is needed.
 *
 * Mirrors the existing nullable `images` JSONB column. `IF NOT EXISTS` /
 * `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductCategories1803000000000 implements MigrationInterface {
  name = 'AddProductCategories1803000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "categories" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "categories"`);
  }
}

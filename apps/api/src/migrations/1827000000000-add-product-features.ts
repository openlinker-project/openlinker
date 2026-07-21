/**
 * Add Product Features (#1752)
 *
 * Adds a nullable `features` JSONB column to `products` — the source-platform
 * product-level attributes carried on `Product.features` (`{ name, value }[]`,
 * e.g. Brand / Material). Until now the master product sync fetched and mapped
 * these features but dropped them on persist (no column). Existing rows get
 * `NULL`; the column repopulates on the next product sync, so no backfill is
 * needed.
 *
 * Mirrors the existing nullable `categories` / `images` JSONB columns.
 * `IF NOT EXISTS` / `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductFeatures1827000000000 implements MigrationInterface {
  name = 'AddProductFeatures1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "features" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "features"`);
  }
}

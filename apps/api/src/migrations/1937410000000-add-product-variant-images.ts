/**
 * Add Product Variant Images
 *
 * Adds a nullable `images` JSONB column to `product_variants` - the pictures a
 * ProductMaster dedicates to ONE variant (absolute URLs, in the master's
 * order), e.g. the red cup's photo on a product sold in four colours. Before
 * this a variant could not carry a picture at all, so every offer of a
 * multi-variant product was listed with the same product gallery.
 *
 * No backfill: existing rows get `NULL` ("no picture of its own", so the
 * product gallery applies - exactly how every variant behaved before), and a
 * master that reports variant pictures fills the column on its next product
 * sync.
 *
 * Mirrors the nullable `attributes` JSONB column. `IF NOT EXISTS` /
 * `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductVariantImages1937410000000 implements MigrationInterface {
  name = 'AddProductVariantImages1937410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "images" jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "images"`);
  }
}

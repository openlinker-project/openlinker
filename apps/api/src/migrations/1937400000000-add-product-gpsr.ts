/**
 * Add Product GPSR
 *
 * Adds a nullable `gpsr` JSONB column to `products` - the neutral EU General
 * Product Safety Regulation data a ProductMaster states about a product
 * (`ProductGpsr`: producer, responsible person, importer, safety information),
 * carried by value rather than by platform id.
 *
 * No backfill: existing rows get `NULL` ("nothing to declare from the
 * catalogue"), and a master that reports GPSR fills the column on its next
 * product sync. A master that never reports it leaves it `NULL`, which is the
 * behaviour every product had before this column existed.
 *
 * Mirrors the nullable `features` / `categories` JSONB columns. `IF NOT EXISTS`
 * / `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductGpsr1937400000000 implements MigrationInterface {
  name = 'AddProductGpsr1937400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "gpsr" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "gpsr"`);
  }
}

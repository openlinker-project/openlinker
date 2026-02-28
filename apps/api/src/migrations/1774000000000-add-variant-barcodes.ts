/**
 * Migration: Add variant barcodes (ean/gtin)
 *
 * Adds nullable barcode columns to product_variants, creates partial indexes,
 * and backfills from attributes JSON where valid.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVariantBarcodes1774000000000 implements MigrationInterface {
  name = 'AddVariantBarcodes1774000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "ean" character varying`);
    await queryRunner.query(`ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "gtin" character varying`);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_variants_ean_not_null"
      ON "product_variants" ("ean")
      WHERE "ean" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_product_variants_gtin_not_null"
      ON "product_variants" ("gtin")
      WHERE "gtin" IS NOT NULL
    `);

    // Backfill ean from attributes->>'ean' (EAN-13 only)
    await queryRunner.query(`
      UPDATE "product_variants"
      SET "ean" = normalized.value
      FROM (
        SELECT
          id,
          regexp_replace(COALESCE(attributes->>'ean', ''), '\\\\D', '', 'g') AS value
        FROM "product_variants"
      ) AS normalized
      WHERE "product_variants"."id" = normalized.id
        AND "product_variants"."ean" IS NULL
        AND length(normalized.value) = 13
    `);

    // Backfill gtin from attributes->>'gtin' (GTIN-8/10/12/13/14)
    await queryRunner.query(`
      UPDATE "product_variants"
      SET "gtin" = normalized.value
      FROM (
        SELECT
          id,
          regexp_replace(COALESCE(attributes->>'gtin', ''), '\\\\D', '', 'g') AS value
        FROM "product_variants"
      ) AS normalized
      WHERE "product_variants"."id" = normalized.id
        AND "product_variants"."gtin" IS NULL
        AND length(normalized.value) IN (8, 10, 12, 13, 14)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_variants_gtin_not_null"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_product_variants_ean_not_null"`);

    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "gtin"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "ean"`);
  }
}

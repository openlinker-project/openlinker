/**
 * Add Product Variant Cost
 *
 * Adds the operator-authored net (VAT-exclusive) unit cost to `product_variants`
 * (#3588, epic #3516, D27): `netUnitCost` + `costCurrency` plus provenance
 * (`costUpdatedAt`, `costUpdatedByUserId`). NULL means "not recorded", never zero;
 * `0.00` is a valid cost. Master sync never writes these columns.
 *
 * No backfill: every existing variant reads "not recorded". `IF NOT EXISTS` /
 * `IF EXISTS` guards keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductVariantCost1938300000000 implements MigrationInterface {
  name = 'AddProductVariantCost1938300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants"
         ADD COLUMN IF NOT EXISTS "netUnitCost" numeric(12,4),
         ADD COLUMN IF NOT EXISTS "costCurrency" varchar(3),
         ADD COLUMN IF NOT EXISTS "costUpdatedAt" timestamptz,
         ADD COLUMN IF NOT EXISTS "costUpdatedByUserId" text`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants"
         ADD CONSTRAINT "CHK_product_variants_cost_pair"
         CHECK (("netUnitCost" IS NULL) = ("costCurrency" IS NULL))`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants"
         ADD CONSTRAINT "CHK_product_variants_cost_non_negative"
         CHECK ("netUnitCost" IS NULL OR "netUnitCost" >= 0)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "CHK_product_variants_cost_non_negative"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP CONSTRAINT IF EXISTS "CHK_product_variants_cost_pair"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants"
         DROP COLUMN IF EXISTS "costUpdatedByUserId",
         DROP COLUMN IF EXISTS "costUpdatedAt",
         DROP COLUMN IF EXISTS "costCurrency",
         DROP COLUMN IF EXISTS "netUnitCost"`
    );
  }
}

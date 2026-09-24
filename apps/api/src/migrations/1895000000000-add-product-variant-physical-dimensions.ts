/**
 * Add `product_variants."weightGrams"/"lengthMm"/"widthMm"/"heightMm"`
 * (#3403, mockup-parity epic #3401)
 *
 * Operator-authored physical master data, captured during product setup and
 * DISPLAYED at the pack bench (#3419) — never captured there. The bench has
 * no scale and no measuring UI; the mockup's own research notes explicitly
 * rule that out. Units match the existing `ParcelSpec.weightGrams` /
 * `dimensions.{length,width,height}` shape in `libs/core/src/shipping`
 * (grams, millimetres) so a value captured here feeds a real shipment with
 * no conversion.
 *
 * ## Nullable, no default
 *
 * `null` means "not recorded" for every pre-existing variant and for any
 * operator who never fills the field in — never zero, and never inferred
 * from anything else.
 *
 * ## No index
 *
 * Nothing filters or sorts by these columns in SQL; they are read per-row on
 * the bench only.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductVariantPhysicalDimensions1895000000000 implements MigrationInterface {
  name = 'AddProductVariantPhysicalDimensions1895000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "weightGrams" INTEGER`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "lengthMm" INTEGER`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "widthMm" INTEGER`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "heightMm" INTEGER`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "heightMm"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "widthMm"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "lengthMm"`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "weightGrams"`
    );
  }
}

/**
 * Record WHY the master could not state a rate (#2264, ADR-063).
 *
 * `TaxRateUnknownReason` already existed and already distinguished a shop with
 * no tax configuration (`not-configured`) from one whose configuration has
 * several candidate rates and no unambiguous pick (`ambiguous`) - and the two
 * need completely different fixes. But the reason had nowhere to live: both
 * arms collapsed into the identical `{ code: null, readAt: <now> }` row, so
 * `ambiguous` was unreachable from every read surface and an operator saw one
 * undifferentiated "no tax rate" for both.
 *
 * Additive, nullable, no backfill. `NULL` is honest for every existing row:
 * the reason was never recorded, which is not the same as `not-configured`.
 * A row with a rate carries no reason either, so the column is meaningful only
 * where `taxRateReadAt IS NOT NULL AND taxRate IS NULL`.
 *
 * Deliberately a plain varchar rather than a Postgres enum, matching every
 * other `as const` union in this schema: a new reason must not need a
 * migration, and an unrecognised stored value degrades to "no reason given"
 * rather than failing the read.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductTaxRateUnknownReason1841000000005 implements MigrationInterface {
  name = 'AddProductTaxRateUnknownReason1841000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "taxRateUnknownReason" character varying(32)`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "taxRateUnknownReason" character varying(32)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "taxRateUnknownReason"`
    );
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "taxRateUnknownReason"`);
  }
}

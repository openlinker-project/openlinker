/**
 * Add the per-line tax-rate projection to the catalogue (#2054, ADR-052).
 *
 * Additive and nullable, with **no backfill**: inventing a rate is exactly the
 * failure this epic removes. Every existing row therefore lands in the
 * *never checked* state (`taxRateReadAt IS NULL`), which is the truth - the
 * master has not been asked yet - and is deliberately distinct from *checked,
 * and the shop has no rate* (`taxRateReadAt IS NOT NULL AND taxRate IS NULL`).
 * Without that separation the gate would claim the whole catalogue is
 * incomplete on day one and the pre-rollout coverage count would measure
 * nothing.
 *
 * The two partial indexes exist because both states must be answerable as a
 * query rather than a crawl: "which products have no rate" backs the operator
 * surface, "which have not been checked" backs the sync suggestion.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductTaxRate1840000000000 implements MigrationInterface {
  name = 'AddProductTaxRate1840000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "taxRate" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "taxRateCountry" character varying(2)`
    );
    await queryRunner.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "taxRateReadAt" TIMESTAMP WITH TIME ZONE`
    );

    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "taxRate" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "taxRateCountry" character varying(2)`
    );
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "taxRateReadAt" TIMESTAMP WITH TIME ZONE`
    );

    // "Not yet checked" - the sync suggestion's population.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_tax_rate_unchecked"
        ON "products" ("id")
        WHERE "taxRateReadAt" IS NULL
    `);
    // "Checked, and the shop has no rate" - the population that holds documents.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_products_tax_rate_missing"
        ON "products" ("id")
        WHERE "taxRateReadAt" IS NOT NULL AND "taxRate" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_tax_rate_missing"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_products_tax_rate_unchecked"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "taxRateReadAt"`);
    await queryRunner.query(
      `ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "taxRateCountry"`
    );
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN IF EXISTS "taxRate"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "taxRateReadAt"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "taxRateCountry"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "taxRate"`);
  }
}

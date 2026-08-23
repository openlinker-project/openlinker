/**
 * Transcribe the per-line tax rate onto `order_line_items` (#2250, ADR-052 § 4).
 *
 * The order snapshot is where a rate is SETTLED. This table is the queryable
 * copy (#1985), so an analytics read never has to expand JSON to answer "which
 * lines carry which rate" or "how much revenue was booked at 8%".
 *
 * All three columns travel together, and that is the point. A single nullable
 * rate cannot separate *no rate*, *never read* and *pre-rollout*, so `taxSource`
 * and `taxRateReadAt` ride alongside it (#2245 F3) - the same rule the snapshot
 * line follows.
 *
 * Additive, nullable, and NOT backfilled: a rate invented for a historical line
 * would be exactly the guess this epic removes. Rows written before this
 * migration simply carry nulls until the order is re-ingested, and #2256's
 * `taxRateEra` marker is what keeps them out of a net-revenue figure meanwhile.
 *
 * The partial index covers the population an operator acts on - lines with no
 * rate - rather than the whole table, matching the shape the two catalogue
 * indexes in the sibling migration already use.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderLineItemTaxRate1840000000004 implements MigrationInterface {
  name = 'AddOrderLineItemTaxRate1840000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_line_items" ADD COLUMN IF NOT EXISTS "taxRate" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items" ADD COLUMN IF NOT EXISTS "taxSource" character varying(16)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items" ADD COLUMN IF NOT EXISTS "taxRateReadAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_line_items_no_tax_rate"
        ON "order_line_items" ("placedAt")
        WHERE "taxRate" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_line_items_no_tax_rate"`);
    await queryRunner.query(
      `ALTER TABLE "order_line_items" DROP COLUMN IF EXISTS "taxRateReadAt"`
    );
    await queryRunner.query(`ALTER TABLE "order_line_items" DROP COLUMN IF EXISTS "taxSource"`);
    await queryRunner.query(`ALTER TABLE "order_line_items" DROP COLUMN IF EXISTS "taxRate"`);
  }
}

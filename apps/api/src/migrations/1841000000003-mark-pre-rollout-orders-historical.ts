/**
 * Mark orders that predate per-line tax rates (#2256, ADR-063 § Consequences).
 *
 * Orders ingested before this epic carry no rate on any line, and the document
 * issued for them used whatever the provider adapter defaulted to. They are
 * marked rather than blocked: blocking would stop history nobody is going to
 * retrofit, and nothing about them can be corrected after the fact.
 *
 * The marker's only job is to keep a net-revenue figure honest. A pre-rollout
 * order's tax is not a confirmed rate, so it is EXCLUDED from such a figure
 * rather than back-computed - there is nothing to compute from.
 *
 * Two shape decisions.
 *
 * **Per record, not per line.** The lines live in a jsonb snapshot, so a
 * per-line marker would rewrite every snapshot in the table for a value that is
 * uniform across an order and that no surface renders per line. The frontend
 * deliberately shows nothing for it: it appeared in one place with no action
 * attached, so it is analytics data, not a badge.
 *
 * **Backfilled deliberately, and this is not the backfill the epic forbids.**
 * What must never be invented is a tax RATE. Recording that an order predates
 * the feature is a fact about OpenLinker's own history, and it is exactly what
 * lets a later reader avoid mistaking a defaulted rate for a stated one.
 *
 * Idempotent and safe to re-run: the column add is `IF NOT EXISTS` and the
 * update touches only rows where the marker is still null AND no rate has ever
 * been settled on a line - so an order ingested between two runs of this
 * migration is not retroactively called historical.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class MarkPreRolloutOrdersHistorical1841000000003 implements MigrationInterface {
  name = 'MarkPreRolloutOrdersHistorical1841000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "taxRateEra" character varying(16)`
    );

    // `jsonb_path_exists` asks "does ANY line carry a non-empty taxRate?".
    // Guarding on it rather than on a timestamp is what makes a re-run safe:
    // an order ingested after the first run already carries rates and is
    // therefore skipped, with no cutover instant to get wrong.
    await queryRunner.query(`
      UPDATE "order_records"
         SET "taxRateEra" = 'pre-rollout'
       WHERE "taxRateEra" IS NULL
         AND NOT jsonb_path_exists(
               "orderSnapshot",
               '$.items[*].taxRate ? (@ != "")'
             )
    `);

    // Analytics reads "the orders whose tax is stated", so the index covers
    // the population that is NOT marked - the one that grows.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_tax_rate_era"
        ON "order_records" ("createdAt")
        WHERE "taxRateEra" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_tax_rate_era"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "taxRateEra"`);
  }
}

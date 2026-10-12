/**
 * Price-basis correction markers (#3737, ADR-077)
 *
 * ADR-077 makes every catalogue price gross. PrestaShop and WooCommerce
 * product masters used to report whatever their platform stores - net for
 * PrestaShop, store-dependent for WooCommerce - so the first sync after this
 * release moves many stored prices by the VAT rate at once. Offers already live
 * on a sales channel must not be re-priced by that wave without an operator
 * approving it, even on a pair set to automatic price sync. Two columns make
 * that possible:
 *
 * - `product_variants."priceBasisPending"`: set here for every PRICED variant
 *   of a product mapped to a PrestaShop or WooCommerce connection that has
 *   `ProductMaster` enabled. The master sync stamps a price change observed
 *   while it is set as a tax-basis correction, and the variant repository
 *   clears it on the first upsert that carries a price. A variant with no
 *   recorded price is left unflagged: its first price is not a correction of
 *   anything.
 * - `price_change_episodes."cause"`: carries `'tax-basis-correction'` onto the
 *   episode, which the detector never auto-applies.
 *
 * The backfill runs in this migration rather than at runtime because the
 * migration IS the upgrade boundary: a clock- or config-based window would
 * either expire before a slow catalogue sweep reached every variant or survive
 * into ordinary price changes. Subiekt and every other master already report
 * gross and are not flagged.
 *
 * Cost and lock (#3740 review). The matching product ids are collected into a
 * temporary table FIRST, before anything locks `product_variants`: that read
 * walks `connections` (a handful of rows) and probes `identifier_mappings`
 * through its `(entityType, connectionId, internalId)` index once per
 * matching connection, instead of once per variant. Only then does the
 * `ALTER TABLE` take its lock, and the `UPDATE` is a single hash join against
 * the temp table. Adding a column with a constant default is a metadata-only
 * change in PostgreSQL 11+, so the lock is held for the `UPDATE` alone.
 *
 * This migration must never run its backfill twice. TypeORM decides pending
 * by class name, so a renumber re-runs it on every database that already
 * applied it, and by then `clearPriceBasisPending` has cleared the flag on
 * every corrected variant: re-flagging them would open a SECOND correction
 * wave over prices that were already corrected. So the backfill runs only
 * when this migration itself creates the column; if the column is already
 * there, the backfill is skipped. The `cause` column is `IF NOT EXISTS`
 * guarded for the same reason.
 *
 * `down()` drops both columns. Any correction episodes still open keep their
 * rows and simply lose the marker, after which an automatic pair would apply
 * them - the pre-#3737 behaviour.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceBasisCorrection1937370000000 implements MigrationInterface {
  name = 'AddPriceBasisCorrection1937370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const existing = (await queryRunner.query(
      `SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'product_variants'
          AND column_name = 'priceBasisPending'`
    )) as unknown[];

    if (existing.length === 0) {
      // Read the mapping table once, before `product_variants` is locked.
      await queryRunner.query(`
        CREATE TEMP TABLE "price_basis_correction_products" AS
        SELECT DISTINCT m."internalId" AS "productId"
          FROM "connections" c
          JOIN "identifier_mappings" m
            ON m."connectionId" = c."id"
           AND m."entityType" = 'Product'
         WHERE c."platformType" IN ('prestashop', 'woocommerce')
           AND c."enabledCapabilities" @> '["ProductMaster"]'::jsonb
      `);
      await queryRunner.query(
        `ALTER TABLE "product_variants" ADD "priceBasisPending" boolean NOT NULL DEFAULT false`
      );
      await queryRunner.query(`
        UPDATE "product_variants" v
           SET "priceBasisPending" = true
          FROM "price_basis_correction_products" t
         WHERE v."productId" = t."productId"
           AND v."price" IS NOT NULL
      `);
      await queryRunner.query(`DROP TABLE "price_basis_correction_products"`);
    }

    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ADD COLUMN IF NOT EXISTS "cause" character varying(32)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_change_episodes" DROP COLUMN "cause"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "priceBasisPending"`);
  }
}

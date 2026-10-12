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
 * `down()` drops both columns. Any correction episodes still open keep their
 * rows and simply lose the marker, after which an automatic pair would apply
 * them - the pre-#3737 behaviour.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPriceBasisCorrection1937370000000 implements MigrationInterface {
  name = 'AddPriceBasisCorrection1937370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "product_variants" ADD "priceBasisPending" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(`
      UPDATE "product_variants" v
         SET "priceBasisPending" = true
       WHERE v."price" IS NOT NULL
         AND EXISTS (
           SELECT 1
             FROM "identifier_mappings" m
             JOIN "connections" c ON c."id" = m."connectionId"
            WHERE m."entityType" = 'Product'
              AND m."internalId" = v."productId"
              AND c."platformType" IN ('prestashop', 'woocommerce')
              AND c."enabledCapabilities" @> '["ProductMaster"]'::jsonb
         )
    `);
    await queryRunner.query(
      `ALTER TABLE "price_change_episodes" ADD "cause" character varying(32)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "price_change_episodes" DROP COLUMN "cause"`);
    await queryRunner.query(`ALTER TABLE "product_variants" DROP COLUMN "priceBasisPending"`);
  }
}

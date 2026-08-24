/**
 * Backfill `order_records.taxTreatment` for PrestaShop and WooCommerce orders (#2440)
 *
 * `order_records.taxTreatment` has been nullable since the #1985 analytics
 * read model landed, and until this change the PrestaShop and WooCommerce
 * order-source adapters never asserted it — their line prices are net
 * (PrestaShop's `order_details.product_price`, WooCommerce's
 * `line_items[].price`) but nothing on the order said so. A net-tax-basis
 * derivation (`deriveNetAmount`, #2440) that assumed every unmarked line was
 * gross would deduct VAT a second time from every PrestaShop/WooCommerce
 * line, understating Net Sales/AOV/Median/Cancellations Value for the two
 * platforms that actually price net.
 *
 * The adapter fix (this same PR) only reaches ORDERS INGESTED FROM NOW ON.
 * This migration backfills the flag on history, following the exact
 * platform-scoped join precedent set by
 * `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.ts`
 * (`FROM "connections" c WHERE c."id" = o."sourceConnectionId" AND
 * c."platformType" = '...'`) rather than inferring the platform from
 * anything on the order row itself.
 *
 * Idempotent by construction (`WHERE "taxTreatment" IS NULL`) — a re-run
 * touches only rows a later fix hasn't already reached, matching the house
 * convention documented on `1818000000004-backfill-ksef-provider-invoice-number.ts`
 * and `1840000000001-add-order-analytics-read-model.ts`.
 *
 * Deliberately does NOT touch any other platform. A connection whose
 * platform is unknown or whose basis this migration cannot assert stays
 * `taxTreatment IS NULL` — the net-tax-basis derivation treats that as "no
 * resolvable basis" and excludes the order from a net figure rather than
 * guessing, exactly as it does for a genuinely missing tax rate.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillOrderRecordsTaxTreatment1841000000006 implements MigrationInterface {
  name = 'BackfillOrderRecordsTaxTreatment1841000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "order_records" o
      SET "taxTreatment" = 'exclusive'
      FROM "connections" c
      WHERE c."id" = o."sourceConnectionId"
        AND c."platformType" IN ('prestashop', 'woocommerce')
        AND o."taxTreatment" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op. `taxTreatment` was NULL before this migration
    // touched it, and NULL is not "we asserted the source doesn't say" — it's
    // "nothing has looked yet". Re-nulling it after a rollback would discard
    // a true fact about how these platforms price their lines for no reason;
    // any surface reading the column already treats NULL and 'exclusive'
    // identically wherever it doesn't drive net-tax-basis math.
  }
}

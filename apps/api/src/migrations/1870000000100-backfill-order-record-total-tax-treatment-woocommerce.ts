/**
 * Backfill `order_records.totalTaxTreatment` for WooCommerce (#2836).
 *
 * `1870000000000-add-order-record-total-tax-treatment.ts` (#2829/#2832) added
 * the column and backfilled it for PrestaShop only, explicitly deferring
 * WooCommerce to this issue — see that migration's own doc comment and
 * `OrderTotals.totalTaxTreatment`'s.
 *
 * WooCommerce has the identical structural split PrestaShop does: line
 * prices (`line_items[].price`) are net, so `taxTreatment` stays
 * `'exclusive'`, but the order TOTAL (`order.total`) genuinely is gross —
 * see `woocommerce-order-source.adapter.ts`'s `mapTotals`, the adapter-side
 * half of #2836.
 *
 * This is a SEPARATE migration rather than an edit to 1870000000000, and
 * that is deliberate rather than the ceremony it looks like
 * (`docs/migrations.md` rule 4, "never edit an already-executed migration"):
 * 1870000000000 ships in a sibling PR (#2832) that may merge — and run in a
 * live environment — before this one lands. Editing that file in place would
 * make the WooCommerce backfill's effect depend on merge order: if
 * 1870000000000 already executed anywhere, TypeORM's migrations table would
 * never re-run it, and an in-place edit adding the WooCommerce arm would
 * silently never apply. A standalone, order-independent migration has no
 * such dependency — it runs (and backfills WooCommerce) whenever it is
 * deployed, regardless of when 1870000000000 ran.
 *
 * Idempotent by construction (`WHERE "totalTaxTreatment" IS NULL`), matching
 * 1870000000000's own guard and the house convention documented on
 * `1818000000004-backfill-ksef-provider-invoice-number.ts` — a re-run (or a
 * run before/after 1870000000000, in either order) touches only rows a
 * platform-scoped fix hasn't already reached.
 *
 * Generated: 2026-09-04 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1870000000000 is #2829/#2832's `totalTaxTreatment` column + the
 * PrestaShop backfill).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillOrderRecordTotalTaxTreatmentWoocommerce1870000000100
  implements MigrationInterface
{
  name = 'BackfillOrderRecordTotalTaxTreatmentWoocommerce1870000000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "order_records" o
      SET "totalTaxTreatment" = 'inclusive'
      FROM "connections" c
      WHERE c."id" = o."sourceConnectionId"
        AND c."platformType" = 'woocommerce'
        AND o."totalTaxTreatment" IS NULL
    `);
  }

  public async down(): Promise<void> {
    // Deliberate no-op, matching 1841000000006's down() — this migration only
    // SETs a value on a pre-existing column (added by 1870000000000), it
    // never adds or drops a column, so there is nothing to reverse. Rolling
    // back would also be unsound: it cannot distinguish a row this migration
    // set from one a later, unrelated write also set to 'inclusive'.
  }
}

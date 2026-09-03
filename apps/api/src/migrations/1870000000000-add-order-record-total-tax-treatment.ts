/**
 * Add `order_records.totalTaxTreatment` and backfill it for PrestaShop (#2829/#2832).
 *
 * `order_records.taxTreatment` (#1985/#2440) describes the LINE prices /
 * subtotal — for PrestaShop those are net (`order_details.product_price`),
 * so the column reads `'exclusive'`. But PrestaShop's order TOTAL
 * (`total_paid_tax_incl`) genuinely is gross, and the `orderTotalGross`
 * sales-document rule condition reads `taxTreatment` to decide whether it may
 * trust the total as gross at all — so no PrestaShop order could ever match
 * that condition, regardless of its real tax setup.
 *
 * `taxTreatment` cannot simply be flipped to `'inclusive'`: it also drives
 * `PrestashopOrderProcessorManagerAdapter.convertGrossToNet` (destination-side
 * line pinning) and the ADR-063 net-sales tax-rate resolution path
 * (`deriveNetLineAmount` + its SQL twins), both of which need the LINE-level
 * fact to stay `'exclusive'`. `totalTaxTreatment` is the narrower, additive
 * column describing the total's own inclusivity alone — `null` means "same as
 * `taxTreatment`" (see `OrderRecord.totalTaxTreatment` and
 * `SalesDocumentViewService.toOrderFacts`, which reads
 * `totalTaxTreatment ?? taxTreatment`, the same fallback the live-`Order`
 * gate applies via `toSalesDocumentOrderFacts`).
 *
 * The adapter fix (companion PR) only reaches orders ingested from now on.
 * This migration backfills history for PrestaShop, following the exact
 * platform-scoped join precedent set by
 * `1841000000006-backfill-order-records-tax-treatment.ts` (itself following
 * `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.ts`).
 *
 * Idempotent by construction (`WHERE "totalTaxTreatment" IS NULL`) — a re-run
 * touches only rows a later fix hasn't already reached, matching the house
 * convention documented on `1818000000004-backfill-ksef-provider-invoice-number.ts`.
 *
 * Deliberately does NOT touch WooCommerce, despite the identical structural
 * split (net line prices + `total_tax` decomposed separately, but `total` is
 * genuinely gross) — tracked as a follow-up (#2836) and cited from
 * `OrderTotals.totalTaxTreatment`'s doc comment. A connection whose platform
 * this migration does not assert stays `totalTaxTreatment IS NULL`, i.e.
 * "same as `taxTreatment`", which is the existing (net-priced) behaviour —
 * never a guess.
 *
 * Generated: 2026-09-03 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1869000000900 is #2385's `automation_runs` retry-attempt column).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordTotalTaxTreatment1870000000000 implements MigrationInterface {
  name = 'AddOrderRecordTotalTaxTreatment1870000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "totalTaxTreatment" varchar`
    );

    await queryRunner.query(`
      UPDATE "order_records" o
      SET "totalTaxTreatment" = 'inclusive'
      FROM "connections" c
      WHERE c."id" = o."sourceConnectionId"
        AND c."platformType" = 'prestashop'
        AND o."totalTaxTreatment" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Unlike 1841000000006's down() (a deliberate no-op — that migration only
    // SET a pre-existing column), this one ADDS the column, so dropping it is
    // the only sound reversal.
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "totalTaxTreatment"`
    );
  }
}

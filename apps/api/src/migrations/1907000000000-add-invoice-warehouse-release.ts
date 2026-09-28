/**
 * Add invoice_records.warehouseReleaseOutcome + warehouseReleaseNumber
 *
 * Whether the goods the document billed for actually LEFT the seller's
 * warehouse in the provider's own books, and under which document number.
 *
 * The Subiekt bridge has always answered this - `issueInvoice` returns
 * `warehouseReleaseNumber`, the WZ (Wydanie Zewnetrzne) it created or detected
 * beside the invoice - and OpenLinker discarded it. A repo-wide search for the
 * field found a type declaration, three specs, and no production reader at all.
 *
 * It matters because the release is genuinely fragile and its failure is
 * invisible. `SubiektInvoicingAdapter.resolveZkId` returns `null` on two paths,
 * and the bridge's own fallback for that case looks the order up by a column
 * stamped with the marketplace order NUMBER rather than OpenLinker's internal
 * id - the adapter's docblock records that this "never matched a natural
 * order". So when the ZK id is missing, no WZ is created, the invoice issues
 * with the correct money, the client is billed, and the stock never moves. The
 * order shows green. The only way to notice was to open Subiekt.
 *
 * This is the sibling of `unlinkedCatalogueLines` (1903000000000) and shares
 * its reasoning: a document that looks entirely normal while the warehouse
 * never registers the sale. That one covers a line the provider could not link;
 * this one covers the release document as a whole.
 *
 * ## Two columns, because `null` alone cannot say which silence it is
 *
 * The bridge's `null` conflates "there was nothing to release" (a manually
 * issued, order-less invoice) with "we could not find what to release". Only
 * OpenLinker can tell those apart, because only OpenLinker knows whether it
 * passed a `zkId` - so the adapter resolves it and stores the ANSWER rather
 * than the raw wire value:
 *
 *   NULL              - this provider does not report a release at all. inFakt,
 *                       KSeF and eparagony never will; they have no warehouse.
 *   'released'        - a release document exists; `warehouseReleaseNumber`
 *                       names it.
 *   'not-applicable'  - there was nothing to release. Correct and quiet.
 *   'not-released'    - OpenLinker expected one and the provider reported none.
 *                       THIS is the state the columns exist for.
 *
 * A surface must therefore test the outcome, never the number's nullability:
 * `warehouseReleaseNumber` is legitimately NULL on three of the four states.
 *
 * Nullable with no default and no backfill, for the 1903 reason verbatim: every
 * existing row predates the columns and nothing records what its documents did,
 * so NULL - "not reported" - is truthful, while a manufactured 'released' would
 * assert that those sales left the warehouse.
 *
 * Unindexed, deliberately, also for the 1903 reason: the value is read through
 * the invoice projection the orders surfaces already load. A worklist of
 * affected orders is an order-level axis (the `taxRateConflict` shape), not an
 * index here.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceWarehouseRelease1907000000000 implements MigrationInterface {
  name = 'AddInvoiceWarehouseRelease1907000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // RENUMBERED 1904 -> 1907. `1904` was already claimed by
    // `add-order-fulfillment-routing-skip-reason` on three branches of the
    // routed-order stack - a collision the review that caught the `1902` one
    // did not yet know about, found by scanning every remote branch rather
    // than by reading `origin/main`.
    //
    // Same rule as the sibling renumber: a renamed class is a NEW migration to
    // TypeORM, so `up()` re-runs on any database that applied `1904`. The DDL
    // below is `IF NOT EXISTS`-guarded and would converge on its own, but the
    // `migrations` table would carry both names; the DELETE keeps one row per
    // migration.
    await queryRunner.query(`DELETE FROM "migrations" WHERE "name" = ANY($1)`, [
      ['AddInvoiceWarehouseRelease1904000000000'],
    ]);
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "warehouseReleaseOutcome" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "warehouseReleaseNumber" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "warehouseReleaseNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "warehouseReleaseOutcome"`,
    );
  }
}

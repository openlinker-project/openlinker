/**
 * Add `fulfillment_works."invoicePrintedAt"`, `"labelPrintedAt"`,
 * `"completedAt"` and `"completedByUserId"` (the pack-bench completion feature)
 *
 * ## The gap this closes
 *
 * The pack bench's last scan closes the box (`parcelClosedAt`) and fires the
 * `order.packed` automation trigger, but everything after that — printing the
 * label, printing the invoice, actually taking the box off the bench — was
 * invisible: nothing recorded whether a document was ever printed, and there
 * was no explicit "this parcel is finished and can go" act. A packer who
 * forgot to print a label was never noticed.
 *
 * Prior art (ShipStation, Linnworks, Veeqo, Brightpearl, Shopify, ShipHero,
 * Zenventory) models neither "documents enclosed" as a checklist nor "label
 * applied" as a state; the recurring shape is ONE explicit completion action
 * separate from printing (ShipHero's "Complete Order", Brightpearl's `Packed`
 * state before `Shipped`). That is what `completedAt` is.
 *
 * ## Two print columns, no version bump, fill-in-when-NULL
 *
 * `invoicePrintedAt` / `labelPrintedAt` are stamped the FIRST time each
 * document is fetched for printing (`markInvoicePrinted` /
 * `markLabelPrinted`, guarded `WHERE "…PrintedAt" IS NULL`), so a reprint
 * never moves them — the question they answer is "was it ever printed", and a
 * later value would make a reprint look like the original print. Both are
 * DISPLAY-ONLY: nothing in `supportedActions` or the ADR-052 authority matrix
 * gates on them, so neither write bumps `version` — the same reading
 * `fulfilledQuantity` / `cancelledQuantity` already carry on this table.
 *
 * ## One completion claim, WITH a version bump
 *
 * `completedAt` / `completedByUserId` are the explicit completion act,
 * written together in ONE statement (`claimCompletion`, guarded
 * `WHERE "completedAt" IS NULL AND "parcelClosedAt" IS NOT NULL` — a parcel
 * cannot be completed before it is packed). Unlike the two print columns,
 * this DOES bump `version`: it is the terminal legality-gated act on this
 * surface, not a passive display fact, so a client polling the parcel must
 * see it as a state change.
 *
 * `completedByUserId` carries no service-actor counterpart the way
 * `packedByUserId` / `packedByService` do — a completion is always an operator
 * act at a terminal in front of the parcel, never something a background
 * process performs on the work object's behalf — so there is no matching
 * `completedByService` column and no CHECK constraint pairing them.
 *
 * ## Nullable, no default, no backfill, no index
 *
 * `null` is the correct state for every row that predates this migration —
 * pretending a pre-existing parcel was printed or completed would fabricate
 * history for something nobody recorded. The ORM entity declares no default
 * either, matching the discipline every sibling migration on this table
 * states: the integration harness builds schema by `synchronize` rather than
 * running migrations, so a default present here and absent there would hold
 * in production and silently not in tests
 * (`fulfillment-work-migration-parity.int-spec.ts` is what would catch it —
 * see that file's `TABLES` list, which already names `fulfillment_works`, so
 * no edit is needed there for the columns themselves).
 *
 * No index on any of the four: nothing orders or filters by them in SQL
 * today. `labelPrintedAt` / `invoicePrintedAt` are read only as part of the
 * per-work parcel projection, already keyed on `id`; `completedAt` is
 * likewise read per-work, and the decision NOT to filter `listBenchWork`'s
 * SQL selection on it (see the bench work service's own docblock) means no
 * read needs one either. An index nothing reads is cost on every write to an
 * already five-writer table (REVIEW C10).
 *
 * ## The down migration is lossless in the only sense that matters
 *
 * Dropping all four columns discards a print/completion audit trail, not a
 * record anything downstream derives from — no document, no shipment and no
 * counter reads any of them. A revert costs the audit trail, not a fact the
 * rest of the system depends on. The `assignedToUserId` / `selfServeEligible`
 * migration (#3336) states the identical reasoning for the identical reason:
 * a sibling advisory/audit column on this same table.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFulfillmentWorkPrintAndCompletion1897000000000 implements MigrationInterface {
  name = 'AddFulfillmentWorkPrintAndCompletion1897000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "invoicePrintedAt" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "labelPrintedAt" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "completedByUserId" UUID`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "completedByUserId"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "completedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "labelPrintedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "invoicePrintedAt"`
    );
  }
}

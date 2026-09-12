/**
 * Add `salesDocumentMatchedRuleId` to `order_records` (#3186).
 *
 * Names the `sales_document_rules` row that decided this order's document
 * kind, when a rule-engine (tier-1) match produced the route — `null` for a
 * tier-2 country default, the pre-#2170 single-primary fallback, or no route
 * at all. It is what lets the sales-document panel's "Why this kind?"
 * disclosure name the rule that actually decided, rather than the connection
 * alone (which the existing "Why this document?" disclosure already answers).
 *
 * Plain `varchar` with NO foreign key to `sales_document_rules` — rules are
 * fully editable/deletable (see `SalesDocumentRule`'s own doc comment: "an
 * adopted rule is fully editable/deletable like any other row"), so this is a
 * reference by value, mirroring `order_changes.orderId` / `refund_records`'s
 * cross-aggregate references rather than a relation OpenLinker enforces. A
 * deleted rule simply leaves the column pointing at nothing; the read side
 * (`SalesDocumentViewService`) degrades that to an absent `matchedRule` on the
 * projection rather than throwing.
 *
 * No index: this column is never filtered or grouped on today (unlike
 * `salesDocumentBlockReason`, which backs the orders-list "Invoicing blocked"
 * chip) — it is read one row at a time, by the order it already belongs to.
 *
 * Written ONLY by `OrderRecordRepository.updateSalesDocumentBlock`, in the
 * SAME statement as the three existing `salesDocumentBlock*` columns
 * (#2100) — see that method's doc comment. Excluded from `toOrm`/`upsert`'s
 * write set for the identical reason those three are: `persistOrder` runs
 * BEFORE the auto-issue gate on every ingestion, so round-tripping it here
 * would null the column and then immediately re-set it, racing a peer
 * transition's own write.
 *
 * No backfill: an existing row was never evaluated against a rule this
 * column could name (the rule engine is #2170, later than this order might
 * be), and inventing one would misattribute a decision nothing actually made.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSalesDocumentMatchedRule1879000000000
  implements MigrationInterface
{
  name = 'AddOrderRecordSalesDocumentMatchedRule1879000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentMatchedRuleId" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentMatchedRuleId"`,
    );
  }
}

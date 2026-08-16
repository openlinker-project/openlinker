/**
 * Add the sales-document block columns to `order_records` (#2100, ADR-041 decision 11).
 *
 * `salesDocumentBlockReason` holds a neutral `SalesDocumentGateBlockReason`
 * naming why OpenLinker issued no fiscal document for the order; `null` means
 * nothing is blocking it. It is INDEXED because it is a real filter axis — the
 * orders list ships an "Invoicing blocked" chip and a `salesDocumentBlocked`
 * count. Both predicate on membership in `SalesDocumentAttentionReasonValues`,
 * NOT on `IS NOT NULL`: `trigger-model-manual` is `parseTriggerModel`'s default,
 * so on a manual install every uninvoiced order carries a reason and an
 * `IS NOT NULL` count would read "Invoicing blocked 4,312" on a healthy system.
 *
 * `salesDocumentUnresolvedReason` carries the routing reason that travelled
 * alongside a `'unresolved-routing'` block (ADR-041 §107) — today always
 * `'ambiguous-connection-no-primary'`. Not indexed: the filter axis is "is this
 * order blocked at all", which the column above answers; this one only refines
 * the operator-facing copy.
 *
 * `salesDocumentBlockDetail` is a PII-free elaboration (ids and counts only,
 * e.g. "3 invoicing connections, none marked primary") rendered verbatim to the
 * operator. Free text, never filtered on, so no index — the same call
 * `mappingFailureReason` (#1689) made.
 *
 * Plain `varchar` with no check constraint, matching `recordStatus`: the union
 * is enforced in TypeScript so a future ADR-041 value needs no DDL, and the
 * repository coerces an unrecognized stored value back to `null` on read.
 *
 * No backfill: an existing row is "not blocked" until the auto-issue gate
 * re-evaluates it on its next order transition, which is exactly right — the
 * historical value is unknown and inventing one would badge orders wrongly.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSalesDocumentBlock1833000000006 implements MigrationInterface {
  name = 'AddOrderRecordSalesDocumentBlock1833000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockReason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentUnresolvedReason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockDetail" text`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_sales_document_block_reason" ` +
        `ON "order_records" ("salesDocumentBlockReason")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_order_records_sales_document_block_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockDetail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentUnresolvedReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockReason"`,
    );
  }
}

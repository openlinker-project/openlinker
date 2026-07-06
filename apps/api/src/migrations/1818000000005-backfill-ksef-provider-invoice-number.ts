/**
 * Migration: Backfill KSeF provider invoice number
 *
 * Before #1338's fix, `KsefInvoicingAdapter.issueInvoice` persisted `null` for
 * `InvoiceRecord.providerInvoiceNumber` even though the FA(3) P_2 document
 * number was already stamped on the wire (as `cmd.orderId`). Any KSeF row
 * issued before that fix is stuck failing the #1289 correction precondition
 * (`providerInvoiceNumber` + `issuedAt` both required) with a misleading
 * "not fully issued yet" error, even though the document is fully issued and
 * cleared. Scoped to `status = 'issued'` so `failed`/`pending` rows — which
 * legitimately have no stamped P_2 — are left untouched. The `IS NULL` guard
 * makes re-running this migration a no-op.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class BackfillKsefProviderInvoiceNumber1818000000005 implements MigrationInterface {
  name = 'BackfillKsefProviderInvoiceNumber1818000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "invoice_records"
         SET "providerInvoiceNumber" = "orderId"
         WHERE "providerType" = 'ksef'
           AND "providerInvoiceNumber" IS NULL
           AND "status" = 'issued'`
    );
  }

  public async down(): Promise<void> {
    // Data backfill only — there is no record of which rows were genuinely
    // null vs. backfilled here, so reverting to null is not recoverable and
    // would only resurrect the #1338 bug. Intentionally irreversible.
  }
}

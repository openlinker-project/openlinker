/**
 * Add Invoice Records Reconcile Index Migration
 *
 * Adds `IDX_invoice_records_reconcile`, the partial composite index backing the
 * KSeF regulatory-status reconciliation scan (#1121): `status = 'issued' AND
 * regulatoryStatus NOT IN ('accepted','rejected','not-applicable')`,
 * connection-scoped, ordered `updatedAt ASC, id ASC`. Partial so terminal /
 * receipt rows (the bulk of the table over time) stay out of the index. Mirrors
 * the existing partial-index idiom on `invoice_records`.
 *
 * Generated: 2026-06-23 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceRecordsReconcileIndex1810000000000 implements MigrationInterface {
  name = 'AddInvoiceRecordsReconcileIndex1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_invoice_records_reconcile"
        ON "invoice_records" ("connectionId", "updatedAt", "id")
        WHERE "status" = 'issued'
          AND "regulatoryStatus" NOT IN ('accepted', 'rejected', 'not-applicable')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_invoice_records_reconcile"`);
  }
}

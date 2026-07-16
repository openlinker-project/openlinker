/**
 * Add Invoice Pending-Submission Index Migration
 *
 * Adds `IDX_invoice_records_pending_submission`, the partial composite index
 * backing the offline-resubmission sweep (#1702, mini-epic #1585): documents in
 * the degraded-mode `regulatoryStatus = 'pending-submission'` window awaiting
 * retransmission to the clearance authority, connection-scoped, ordered
 * `updatedAt ASC, id ASC`. Partial so only the small, transient pending frontier
 * is indexed - the steady-state bulk of `invoice_records` stays out. Mirrors the
 * shape of `IDX_invoice_records_reconcile`. Idempotent up/down.
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoicePendingSubmissionIndex1825000000000 implements MigrationInterface {
  name = 'AddInvoicePendingSubmissionIndex1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_invoice_records_pending_submission"
        ON "invoice_records" ("connectionId", "updatedAt", "id")
        WHERE "regulatoryStatus" = 'pending-submission'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_invoice_records_pending_submission"`,
    );
  }
}

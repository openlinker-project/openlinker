/**
 * Record WHEN a sales-document hold started and ended (#2248, #2245 F4).
 *
 * `salesDocumentBlockReason` is level-triggered: the gate re-decides on every
 * order transition and the writer stores the answer including `null`. That is
 * what makes a reason self-heal, but it also means nothing records that the
 * order was ever held once the hold clears - so the operator-facing age has no
 * clock, and the "the rate arrived, the invoice issued" timeline entry has no
 * instant to hang on (the shipped timeline builds its block entry with
 * `timestamp: null` for exactly this reason).
 *
 * Both columns are additive, nullable and NOT backfilled. Stamping a synthetic
 * "held since" onto history would put an invented age on an operator screen -
 * the same class of invention this epic exists to remove. Orders held before
 * this migration simply have no start instant until their next transition.
 *
 * Written only by `OrderRecordRepository.updateSalesDocumentBlock`, in the same
 * statement that sets the reason, because the transition is the only place both
 * the old and the new value are known.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSalesDocumentBlockInstants1841000000001 implements MigrationInterface {
  name = 'AddOrderRecordSalesDocumentBlockInstants1841000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "salesDocumentBlockReleasedAt" TIMESTAMP WITH TIME ZONE`
    );
    // The age query is "oldest held order first", so the index covers the
    // held population only - a partial index, matching the shape of the
    // reason column's own filter.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_sales_document_blocked_at"
        ON "order_records" ("salesDocumentBlockedAt")
        WHERE "salesDocumentBlockReason" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_sales_document_blocked_at"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockReleasedAt"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "salesDocumentBlockedAt"`
    );
  }
}

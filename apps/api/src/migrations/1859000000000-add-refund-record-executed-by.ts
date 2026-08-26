/**
 * Add `refund_records.executedBy` (#2371, ADR-056)
 *
 * WHO moved the buyer's money. OpenLinker ships no refund WRITE, so on every
 * path reachable today a human refunded out of band and OL records that fact
 * rather than claiming to have refunded anything itself.
 *
 * **The DEFAULT is the backfill, and it is truthful rather than convenient**:
 * every row predating this column was recorded by an operator through the
 * capture endpoint after moving the money elsewhere, which is exactly what
 * `operator_out_of_band` asserts. No separate backfill pass exists because
 * there is no row for which a different value would be correct.
 *
 * `varchar` rather than a DB enum — the house convention, so widening
 * `RefundExecutedByValues` never needs an `ALTER TYPE`.
 *
 * Note `refund_records.returnId` is NOT touched here: that column has existed
 * since #2327 (`1846000000000-create-returns.ts`) as persistence-only, and
 * #2371 supplies its first writer in the domain/repository layer only.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefundRecordExecutedBy1859000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "refund_records" ADD COLUMN IF NOT EXISTS "executedBy" varchar(32) NOT NULL DEFAULT 'operator_out_of_band'`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "refund_records" DROP COLUMN IF EXISTS "executedBy"`);
  }
}

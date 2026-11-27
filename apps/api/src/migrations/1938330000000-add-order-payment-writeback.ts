/**
 * Add the per-destination payment writeback record to `order_records` (#3963).
 *
 * `paymentWriteback` (jsonb, keyed by destination connection id) records
 * whether a payment that arrived after a shop got the order has reached that
 * shop, and doubles as the at-most-once claim. `paymentWritebackProblem` is a
 * denormalised flag the writer recomputes in the same statement, so the orders
 * list filter and its count read a tiny partial index instead of scanning jsonb
 * (the #2943 pattern).
 *
 * Nullable / defaulted with no backfill: an order provisioned before this
 * migration has no entry, and the writeback rule treats it as a candidate only
 * when the previous record was positively unpaid. Every other existing order
 * behaves exactly as before.
 *
 * The partial index is declared on the ORM entity as well, because the
 * integration harness builds schema by `synchronize`.
 *
 * Generated: 2026-11-05 (synthetic sequential prefix per docs/migrations.md
 * rule 3).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderPaymentWriteback1938330000000 implements MigrationInterface {
  name = 'AddOrderPaymentWriteback1938330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "paymentWriteback" jsonb`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "paymentWritebackProblem" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_paymentWritebackProblem" ` +
        `ON "order_records" ("paymentWritebackProblem") ` +
        `WHERE "paymentWritebackProblem" = true`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_paymentWritebackProblem"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "paymentWritebackProblem"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "paymentWriteback"`);
  }
}

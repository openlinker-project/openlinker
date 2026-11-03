/**
 * Add `order_records.paymentMethod` (#3294).
 *
 * How the buyer pays - `online`, `bank_transfer`, `cash_on_delivery` or
 * `unknown` - mapped onto a closed neutral vocabulary by each order-source
 * adapter and denormalized here so a query never expands the snapshot JSONB.
 * It sits beside, not inside, `paymentStatus`: that answers "may this ship?",
 * this answers "how is it paid?", and neither derives from the other.
 *
 * Nullable with no default and NO backfill: every existing row reads
 * "the source reported nothing", which the read path folds into `unknown` - the
 * honest answer, since nothing recorded what these orders used (ADR-039's
 * precedent for a field that predates its own migration). A plain `varchar`
 * with no CHECK, like the neighbouring vocabulary columns: the integration
 * harness builds schema by `synchronize`, which would not emit one, so a
 * constraint present only here would hold in production and silently not in
 * tests. The mapping boundary coerces instead.
 *
 * Generated: 2026-10-15 (synthetic sequential prefix per docs/migrations.md
 * rule 3; 1937370000000 is the price-basis-correction migration).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordPaymentMethod1937370001000 implements MigrationInterface {
  name = 'AddOrderRecordPaymentMethod1937370001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "paymentMethod" varchar(32)`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "paymentMethod"`);
  }
}

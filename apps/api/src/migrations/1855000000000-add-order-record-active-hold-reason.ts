/**
 * Add `order_records.activeHoldReason` (#2340, DESIGN §6.3)
 *
 * The denormalised projection of the order's currently-open `order_holds` row,
 * so the derived-lifecycle `CASE` (#2309) and the `?phase=held` filter can
 * answer without joining `order_holds` per bucket.
 *
 * `order_holds` stays the authority. This column is a cache with a staleness
 * window, repaired by `orders.holds.reconcile`; no hold GATE reads it.
 *
 * The index is keyed on `activeHoldReason` — the SAME column the column-level
 * `@Index('IDX_order_records_active_hold')` on `OrderRecordOrmEntity` builds on.
 * It was keyed on `internalOrderId` (the primary key) until the review caught
 * it, which meant the int harness — which builds by `synchronize` — ran a
 * different index under the same name than production does.
 *
 * The index is PARTIAL because the only queries over this column are the
 * reconcile pass's two candidate arms, both of which test `IS NOT NULL` — and
 * on a healthy install that set is a handful of rows out of the whole table.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordActiveHoldReason1855000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "activeHoldReason" text`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_active_hold" ` +
        `ON "order_records" ("activeHoldReason") WHERE "activeHoldReason" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_active_hold"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "activeHoldReason"`
    );
  }
}

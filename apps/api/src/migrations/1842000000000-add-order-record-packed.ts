/**
 * Add order_records packed columns
 *
 * Two nullable columns recording the plain operator fact "this order is packed"
 * and who marked it (#2287). Deliberately a FACT, not a state: nothing here
 * touches `recordStatus`, `fulfillmentState` or the SLA/health derivations, and
 * no policy is gated on it (ADR-045), so it is meaningful for every order —
 * including `omp_fulfilled` ones OpenLinker never dispatches.
 *
 * `packedAt` is indexed because "is it packed" is an operator-facing scan axis,
 * mirroring `cancelledAt`. The index is plain rather than partial: an operator
 * filters both ways ("show me what still needs packing" and "show me what is
 * packed"), so a `WHERE "packedAt" IS NOT NULL` index would serve only half the
 * queries. `packedByUserId` is left unindexed — it is display + attribution
 * only and is never filtered on.
 *
 * The index is named to this table's camelCase convention rather than
 * `migration:generate`'s snake_case, matching its siblings.
 *
 * No FK to `users`: `order_records` FKs across no context today, and a deleted
 * user leaving a dangling id is the honest outcome for an audit fact — the
 * alternative would either block the delete or silently erase who packed it.
 *
 * **No backfill.** Unlike `cancelledAt` (#1984, which could proxy off
 * `updatedAt`), nothing in the existing schema stands in for "was this packed",
 * so every historical row correctly starts unpacked; inventing a proxy would
 * badge history wrongly.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordPacked1842000000000 implements MigrationInterface {
  name = 'AddOrderRecordPacked1842000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "packedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "packedByUserId" uuid`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_packedAt" ON "order_records" ("packedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_packedAt"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "packedByUserId"`
    );
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "packedAt"`);
  }
}

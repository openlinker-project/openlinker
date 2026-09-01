/**
 * Add order_records amendment columns
 *
 * Two nullable columns recording OpenLinker's own observation that the SOURCE
 * amended an order after it was already ingested (#2283) — a line removed,
 * added or re-quantified, or the shipping address edited.
 *
 * An internal FACT, not a lifecycle state: nothing here touches `recordStatus`,
 * `fulfillmentState`, the SLA/health derivations or any status union, and no
 * policy is gated on it. It exists because ingestion overwrites `orderSnapshot`
 * wholesale, so before this the amendment left no trace whatsoever — not even
 * for a shipment left dangling against a line that no longer exists.
 *
 * `lastAmendedAt` is indexed because "which orders did the source change under
 * us" is an operator-facing scan axis, and the index is what makes the deferred
 * list badge/filter cheap. Plain rather than partial, mirroring `packedAt`
 * (#2287): an operator filters both ways. `lastAmendmentChanges` is unindexed —
 * it is rendered, never queried inside.
 *
 * The index is named to this table's camelCase convention rather than
 * `migration:generate`'s snake_case, matching its siblings.
 *
 * **No backfill.** The historical diff is unknowable: the prior snapshot each
 * past amendment overwrote is gone, so there is nothing to reconstruct one from.
 * Inventing a proxy would badge orders as amended on evidence that does not
 * exist — the #2100 / #2287 precedent.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordAmendment1850000000004 implements MigrationInterface {
  name = 'AddOrderRecordAmendment1850000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "lastAmendedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "lastAmendmentChanges" jsonb`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_lastAmendedAt" ON "order_records" ("lastAmendedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_lastAmendedAt"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "lastAmendmentChanges"`
    );
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "lastAmendedAt"`);
  }
}

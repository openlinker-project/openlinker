import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The dispatch-relay reconcile frontier's index (#2728).
 *
 * `fulfillment.work.relaySweep` selects works a holder reported SHIPPED whose
 * `dispatchRelayedAt` is still NULL. That NULL is true of nearly every row on
 * `fulfillment_works` — a work only acquires the stamp once it has both shipped
 * and relayed — so the selective half of the predicate is on this table instead:
 * `"eventKind" = 'shipped'` ordered by `"claimedAt"`.
 *
 * The existing `IDX_fulfillment_progress_claims_claimed_at` serves the ordering
 * and the range but not the kind filter, and `eventKind` is unindexed. This
 * partial index serves all three.
 *
 * **Non-unique, deliberately.** `FulfillmentProgressClaimRepository.claim` uses a
 * bare `ON CONFLICT DO NOTHING`, which its own header records as safe *only while
 * the composite primary key is the table's one uniqueness declaration*. Adding a
 * UNIQUE index here would make an unrelated conflict report "already claimed" and
 * silently suppress a progress write for ever. This adds no uniqueness.
 *
 * Declared under this same name on `FulfillmentProgressClaimOrmEntity`. The
 * duplication is required rather than redundant: the integration harness builds
 * schema by TypeORM `synchronize` and never runs migrations, so an index living
 * only here would exist in production and silently not in tests.
 */
export class AddFulfillmentProgressClaimsShippedIndex1877000000000 implements MigrationInterface {
  name = 'AddFulfillmentProgressClaimsShippedIndex1877000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_fulfillment_progress_claims_shipped"
        ON "fulfillment_progress_claims" ("claimedAt")
        WHERE "eventKind" = 'shipped'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Index-only, so the rollback is unconditionally safe: it drops an access
    // path and no data. The sweep it serves keeps working, more slowly.
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_fulfillment_progress_claims_shipped"
    `);
  }
}

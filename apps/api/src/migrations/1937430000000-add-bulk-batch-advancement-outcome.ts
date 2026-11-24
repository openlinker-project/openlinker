/**
 * Add Bulk Batch Advancement Outcome
 *
 * Adds a nullable `outcome` column (`'succeeded' | 'failed'`) to
 * `bulk_batch_advancements`, recording which batch counter an advancement
 * incremented.
 *
 * Needed because a bulk offer child can be counted twice in different
 * directions over its life (E2E-21): the create handler counts an accepted
 * create (record `validating`) as `succeeded`, and the creation poller may
 * terminalise that same record as `failed` minutes later, after the batch
 * already closed as COMPLETED. Correcting the counters must stay
 * at-most-once, and the only race-free gate for that is a conditional UPDATE
 * on the advancement row (`WHERE outcome = 'succeeded'`) - which needs the
 * outcome stored on the row.
 *
 * Nullable, no default: a row written before this migration has no recorded
 * outcome, and guessing one would let a reclassification adjust a counter
 * the row never incremented. The one case that can be proved is backfilled:
 * a row whose offer-creation record is still `validating` can only have been
 * advanced as `succeeded` (an accepted create maps to the `ok` job outcome),
 * and it is exactly the row a pending poll may still need to reclassify.
 * Every other legacy row stays NULL and is simply never reclassified.
 *
 * `IF NOT EXISTS` / `IF EXISTS` keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBulkBatchAdvancementOutcome1937430000000 implements MigrationInterface {
  name = 'AddBulkBatchAdvancementOutcome1937430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bulk_batch_advancements" ADD COLUMN IF NOT EXISTS "outcome" character varying(16)`
    );
    await queryRunner.query(
      `UPDATE "bulk_batch_advancements" AS a ` +
        `SET "outcome" = 'succeeded' ` +
        `FROM "offer_creation_records" AS r ` +
        `WHERE r."id" = a."offerCreationRecordId" ` +
        `AND r."status" = 'validating' ` +
        `AND a."outcome" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "bulk_batch_advancements" DROP COLUMN IF EXISTS "outcome"`
    );
  }
}

/**
 * Add classification-report column + bulk_batch_advancements table (#737)
 *
 * Two related changes for the bulk-flow worker handler:
 *
 * 1. `offer_creation_records.classificationReport` (jsonb, nullable) —
 *    persists the post-create marketplace classification report
 *    (Allegro Smart today). Single jsonb keeps the column shape
 *    forward-compat against Allegro response changes; the FE distinguishes
 *    `null` (unread / not applicable) from `{ fulfilled: false, ... }`
 *    (classified non-Smart) explicitly.
 *
 * 2. `bulk_batch_advancements` table — at-most-once guard for the
 *    counter-advancement path. Composite PK `(bulkBatchId,
 *    offerCreationRecordId)` + the repository's `INSERT ON CONFLICT DO
 *    NOTHING` query makes the bulk-batch counter increment race-free
 *    across N concurrent worker invocations + worker retries, without a
 *    transaction. Kept as a separate table (vs. a column on
 *    `offer_creation_records`) so the single-offer entity stays clean —
 *    bulk-flow concerns don't leak into the per-attempt record.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSmartClassificationAndBatchAdvancements1798000000000
  implements MigrationInterface
{
  name = 'AddSmartClassificationAndBatchAdvancements1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "offer_creation_records" ADD COLUMN "classificationReport" jsonb`,
    );
    await queryRunner.query(`
      CREATE TABLE "bulk_batch_advancements" (
        "bulkBatchId"            uuid      NOT NULL,
        "offerCreationRecordId"  uuid      NOT NULL,
        "advancedAt"             TIMESTAMP NOT NULL DEFAULT now(),
        PRIMARY KEY ("bulkBatchId", "offerCreationRecordId")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bulk_batch_advancements"`);
    await queryRunner.query(
      `ALTER TABLE "offer_creation_records" DROP COLUMN "classificationReport"`,
    );
  }
}

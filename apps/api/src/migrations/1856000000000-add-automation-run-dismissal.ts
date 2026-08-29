/**
 * Add AF-X dismissal + retry linkage to `automation_runs` (#2387)
 *
 * Three nullable columns and two partial indexes. No backfill: every existing
 * row is an ordinary, un-dismissed, non-retry firing, which is exactly what
 * `NULL` means in all three.
 *
 * **`dismissedByUserId` carries no FK**, following
 * `automation_rules.moneyAckByUserId` on the sibling table — display +
 * attribution only, and a deleted user must neither destroy run history nor
 * block its own deletion. `retryOfRunId` likewise self-references **by value**,
 * the treatment `subjectId` and `ruleId` already get on this table.
 *
 * **`IDX_automation_runs_failed` is deliberately NOT dropped.** #2358 landed it
 * for the AF-X count, and once `dismissedAt` exists its predicate is no longer
 * the attention predicate — but it still serves the `outcome` browse filter, and
 * dropping an index another slice landed, mid-wave, on a table three sibling PRs
 * read, trades a small redundancy for a merge hazard. The overlap is recorded
 * rather than resolved.
 *
 * The ORM decorators declare the same columns and predicates, because the test
 * harness synchronizes from those while production runs this file.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationRunDismissal1856000000000 implements MigrationInterface {
  name = 'AddAutomationRunDismissal1856000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "dismissedAt" TIMESTAMP WITH TIME ZONE`
    );
    await queryRunner.query(
      `ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "dismissedByUserId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "retryOfRunId" uuid`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_automation_runs_attention" ON "automation_runs" ("firedAt") ` +
        `WHERE "outcome" = 'failed' AND "dismissedAt" IS NULL`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_automation_runs_retry_of" ON "automation_runs" ("retryOfRunId") ` +
        `WHERE "retryOfRunId" IS NOT NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_retry_of"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_automation_runs_attention"`);
    await queryRunner.query(
      `ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "retryOfRunId"`
    );
    await queryRunner.query(
      `ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "dismissedByUserId"`
    );
    await queryRunner.query(`ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "dismissedAt"`);
  }
}

/**
 * Add `automation_runs.retryAttempt` (#2666)
 *
 * Gives a retry chain a TERMINAL state. Retry eligibility tested only
 * `outcome === 'failed'`, so a retry that itself failed stayed eligible and a
 * chain could grow without bound, re-offering one underlying failure for ever.
 * The column records a run's position in its chain, so `resolveRetryEligibility`
 * can refuse past `AUTOMATION_MAX_RETRY_ATTEMPTS` as a pure single-row test.
 *
 * A denormalised counter rather than a recursive walk over `retryOfRunId`: it
 * bounds the DATA (the last link refuses to spawn a successor) instead of only
 * bounding a query, and `retryOfRunId` carries no FK, so a walk could not be
 * assumed acyclic and would sit on the operator's page-load path with no
 * `statement_timeout` behind it.
 *
 * `DEFAULT 0` is kept — unlike the drop-after-add pattern used where a default
 * would be an implicit answer for future inserts — because here `0` is the
 * genuine, permanent meaning of "an ordinary firing", and the ORM entity
 * declares the same default so the migration-built and `synchronize`-built
 * schemas agree. Existing rows read `0`, which grants a fresh budget rather
 * than refusing a legitimate retry: the safe direction.
 *
 * Slot `1869000000900` is deliberately OFF the sequence. The ordering invariant
 * compares only against `origin/main` and cannot see the
 * sibling branches in flight on this programme, every one of which would reach
 * for `1870000000000` — three slots have already collided that way.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAutomationRunRetryAttempt1869000000900 implements MigrationInterface {
  name = 'AddAutomationRunRetryAttempt1869000000900';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "retryAttempt" integer NOT NULL DEFAULT 0`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "retryAttempt"`
    );
  }
}

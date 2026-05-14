/**
 * Add Outcome to Sync Jobs
 *
 * Issue #400 (Plan B for #391). Adds a nullable `outcome` column to
 * `sync_jobs` to surface the *business* result of a job (`'ok' |
 * 'business_failure'`) distinctly from the *orchestration* result
 * (`status`). NULL by default — only set on the succeeded path by
 * `SyncJobRepositoryPort.markSucceeded(id, outcome)`. No backfill;
 * historical rows keep NULL outcome (status tells the story for them).
 *
 * Reversible: down() drops the column.
 *
 * Self-healing (#427): some dev DBs acquired the `outcome` column by a
 * prior path — a feature-branch test run, a pre-merge timestamp variant,
 * or a long-ago `synchronize: true` accident — without recording the
 * corresponding `migrations` row. On the first `migration:run` after the
 * canonical `1790000000003` timestamp landed in main, the original
 * non-idempotent `ADD COLUMN` tripped `column "outcome" of relation
 * "sync_jobs" already exists`. The fix mirrors the pattern proven for
 * `AddCurrencyToProducts1790000000002` (#374): `ADD COLUMN IF NOT EXISTS`
 * makes re-application a no-op on affected envs while staying behaviorally
 * identical on fresh DBs and on DBs that already applied the original
 * `up()` cleanly (TypeORM skips already-recorded migrations by name).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutcomeToSyncJobs1790000000003 implements MigrationInterface {
  name = 'AddOutcomeToSyncJobs1790000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "outcome" character varying`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sync_jobs" DROP COLUMN "outcome"`);
  }
}

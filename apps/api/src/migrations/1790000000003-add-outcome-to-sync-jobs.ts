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
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOutcomeToSyncJobs1790000000003 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sync_jobs" ADD "outcome" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sync_jobs" DROP COLUMN "outcome"`);
  }
}

/**
 * Add composite index on sync_jobs(connectionId, jobType, status, updatedAt) (#1982)
 *
 * Supports `SyncJobRepository.findLastSucceededByConnectionAndJobType`,
 * introduced for the analytics data-trust read: `WHERE connectionId AND
 * jobType AND status='succeeded' ORDER BY updatedAt DESC LIMIT 1`. The
 * only pre-existing index on this table with `connectionId` as a prefix is
 * `(connectionId, createdAt)`, which covers neither the `jobType`/`status`
 * filter nor the `updatedAt` sort — without this index Postgres has to
 * materialise and sort every row for the connection. This read sits on the
 * render-blocking path of the analytics page (one call per OrderSource
 * connection, fanned out via Promise.all), so the missing index would
 * compound with connection count and sync-job table growth (a 5-minute
 * poll alone is ~105k rows/connection/year).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobsConnectionJobTypeStatusUpdatedAtIndex1832000000008
  implements MigrationInterface
{
  name = 'AddSyncJobsConnectionJobTypeStatusUpdatedAtIndex1832000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_sync_jobs_connectionId_jobType_status_updatedAt" ON "sync_jobs" ("connectionId", "jobType", "status", "updatedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_sync_jobs_connectionId_jobType_status_updatedAt"`);
  }
}

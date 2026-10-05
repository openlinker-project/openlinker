/**
 * Add `IDX_sync_jobs_status_updatedAt` (#2946)
 *
 * Supports the retention prune's `WHERE "status" = $1 AND "updatedAt" < $2
 * ORDER BY "updatedAt" LIMIT $3` — without it, the delete's oldest-first
 * sub-select would sequential-scan the whole table on every batch as
 * `sync_jobs` grows unboundedly (the exact condition this retention seam
 * exists to close — architecture-overview.md § Sync Manager).
 *
 * Timestamp is this epic's assigned block (1913000000000-1913999999999,
 * #3508); `origin/main`'s tail at branch time was `1901000000000`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobsStatusUpdatedAtIndex1913000000000 implements MigrationInterface {
  name = 'AddSyncJobsStatusUpdatedAtIndex1913000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_sync_jobs_status_updatedAt" ON "sync_jobs" ("status", "updatedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_sync_jobs_status_updatedAt"`);
  }
}

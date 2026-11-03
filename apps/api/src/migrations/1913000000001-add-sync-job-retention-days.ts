/**
 * Add `sync_job_retention_days` / `sync_job_dead_retention_days` (#2946, D16)
 *
 * The two nullable Operational Settings columns D16 asks for: how long a
 * `succeeded` and a `dead` `sync_jobs` row are kept before the retention
 * prune deletes them. NULLABLE, same as every other column on this table
 * (`1849000000003-add-operational-settings.ts`) — `NULL` means "not set,
 * fall through to the env var, then to the code default (30 / 90 days)", so
 * an install that upgrades past this migration and never opens the settings
 * page behaves byte-identically to how it behaved before it: nothing is
 * pruned differently than the code default already would have pruned it.
 *
 * Hand-authored, matching the table's existing migration, for the same
 * reason: `migration:generate` would re-emit the sibling `timestamptz`
 * column as `timestamp without time zone`.
 *
 * Timestamp is this epic's assigned block (1913000000000-1913999999999,
 * #3508), one after this branch's own `1913000000000` (the sync_jobs index).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobRetentionDays1913000000001 implements MigrationInterface {
  name = 'AddSyncJobRetentionDays1913000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "sync_job_retention_days" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "sync_job_dead_retention_days" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "sync_job_dead_retention_days"`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "sync_job_retention_days"`
    );
  }
}

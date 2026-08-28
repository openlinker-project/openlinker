/**
 * Persist how long a sync job's most recent attempt took (#2611, epic #2590).
 *
 * `sync_jobs` recorded no duration at all, so job timing could only be taken
 * from an external clock. That blocked the #2489 baseline campaign and it
 * blocks any throughput or lane-policy work that needs to know what a job
 * costs.
 *
 * The column holds ONE attempt, not a total. `lockedAt` cannot stand in for a
 * start time because the running heartbeat overwrites it every three minutes,
 * and `updatedAt - createdAt` measures queue wait plus retry backoff rather
 * than execution. So the worker measures its own attempt and writes the result
 * in the same UPDATE as the status transition that ends it.
 *
 * Additive, nullable, no backfill. `NULL` is honest for every existing row: no
 * attempt was ever measured, which is not the same as an attempt that took no
 * time. Read surfaces must render NULL as "not measured" and aggregates must
 * exclude it, or historical rows would drag every average toward zero.
 *
 * `integer` milliseconds caps at ~24 days per attempt, far beyond the point
 * where stuck-job recovery requeues a run.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobLastAttemptDuration1849000000000 implements MigrationInterface {
  name = 'AddSyncJobLastAttemptDuration1849000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "lastAttemptDurationMs" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" DROP COLUMN IF EXISTS "lastAttemptDurationMs"`
    );
  }
}

/**
 * Fix sync_jobs timestamp columns to include timezone (#1121).
 *
 * `nextRunAt` and `lockedAt` were declared as `timestamp without time zone`.
 * TypeORM serialises JS `Date` objects to TIMESTAMP columns using local-wall-
 * clock strings (`getFullYear`/`getMonth`/…), not UTC ISO strings — so on a
 * UTC+2 host every newly-created job gets `nextRunAt = wallclock + 2h` stored,
 * and the worker's `WHERE "nextRunAt" <= NOW()` (UTC) skips the row for two
 * hours after creation.
 *
 * The fix: `USING … AT TIME ZONE 'UTC'` casts the stored "naïve" timestamps
 * back to absolute UTC timestamptz — i.e. each stored value is reinterpreted
 * AS IF it was in UTC (which it actually is — TypeORM was writing UTC-epoch
 * values through local-time formatting, so the numbers are already in UTC).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSyncJobsTimestampTz1818000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_jobs"
        ALTER COLUMN "nextRunAt" TYPE timestamptz USING "nextRunAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "lockedAt"  TYPE timestamptz USING "lockedAt"  AT TIME ZONE 'UTC'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_jobs"
        ALTER COLUMN "nextRunAt" TYPE timestamp WITHOUT TIME ZONE USING "nextRunAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "lockedAt"  TYPE timestamp WITHOUT TIME ZONE USING "lockedAt"  AT TIME ZONE 'UTC'
    `);
  }
}

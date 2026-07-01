/**
 * Fix sync_jobs timestamp columns to include timezone.
 *
 * `nextRunAt`, `lockedAt`, `createdAt`, and `updatedAt` were declared as
 * `timestamp without time zone`. A tz-naive column compared against a
 * timezone-aware JS `Date` parameter (see `sync-job.repository.ts`'s
 * `"nextRunAt" <= $2` / `"lockedAt" < :threshold` gating queries) is
 * host-timezone-dependent: on a non-UTC host the comparison can be off by
 * the host's UTC offset, so due jobs are skipped for that long.
 *
 * The fix going forward: `timestamptz` columns make every future write and
 * comparison an absolute-instant operation, independent of both the
 * database session timezone and the application host's local timezone.
 *
 * This migration is a value-preserving type change for existing rows —
 * `USING … AT TIME ZONE 'UTC'` relabels each already-stored naive value as
 * UTC without altering its digits. It does not retroactively correct any
 * rows that were skewed by the pre-fix bug; if this deployment's host ran
 * in a non-UTC timezone, audit in-flight `queued` rows and consider
 * reinterpreting the backlog `AT TIME ZONE '<host-zone>'` instead. Because
 * skewed rows only ever had a `nextRunAt` in the past relative to "now",
 * they self-heal within one host-offset window after this migration runs.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSyncJobsTimestampTz1818000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_jobs"
        ALTER COLUMN "nextRunAt" TYPE timestamptz USING "nextRunAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "lockedAt"  TYPE timestamptz USING "lockedAt"  AT TIME ZONE 'UTC',
        ALTER COLUMN "createdAt" TYPE timestamptz USING "createdAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "updatedAt" TYPE timestamptz USING "updatedAt" AT TIME ZONE 'UTC'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "sync_jobs"
        ALTER COLUMN "nextRunAt" TYPE timestamp WITHOUT TIME ZONE USING "nextRunAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "lockedAt"  TYPE timestamp WITHOUT TIME ZONE USING "lockedAt"  AT TIME ZONE 'UTC',
        ALTER COLUMN "createdAt" TYPE timestamp WITHOUT TIME ZONE USING "createdAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "updatedAt" TYPE timestamp WITHOUT TIME ZONE USING "updatedAt" AT TIME ZONE 'UTC'
    `);
  }
}

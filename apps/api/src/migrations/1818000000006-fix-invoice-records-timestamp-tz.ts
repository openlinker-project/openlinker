/**
 * Fix invoice_records timestamp columns to include timezone.
 *
 * `leaseExpiresAt`, `issuedAt`, `createdAt`, and `updatedAt` were declared as
 * `timestamp without time zone`. A tz-naive column compared against a
 * timezone-aware JS `Date` parameter is host-timezone-dependent: on a
 * non-UTC host the comparison can be off by the host's UTC offset.
 *
 * `leaseExpiresAt` is the higher-severity half — it gates the atomic
 * single-claim CAS lease (`invoice-record.repository.ts`'s `claimForIssue`,
 * `"leaseExpiresAt" <= :now`, #1200) that lets exactly one concurrent
 * same-key retry cross the fiscal-provider boundary. A tz-skew mis-fire
 * either stalls an issuance retry, or — worse — lets a not-yet-expired
 * lease read as expired, letting a second worker double-claim and
 * double-submit a fiscal invoice to KSeF. `issuedAt` hits the same
 * naive-column-vs-`Date` shape in the AC-6 invoice-list date-range filter
 * (`inv.issuedAt >= :issuedFrom` / `<= :issuedTo`, #1119) — lower stakes
 * (a read-only list filter), but a real bug, not cosmetic. `createdAt` /
 * `updatedAt` are not used in a gating comparison today; they're converted
 * alongside for consistency, mirroring #1262's treatment of
 * `sync_jobs.createdAt`/`updatedAt`.
 *
 * The fix going forward: `timestamptz` columns make every future write and
 * comparison an absolute-instant operation, independent of both the
 * database session timezone and the application host's local timezone.
 *
 * This migration is a value-preserving type change for existing rows —
 * `USING … AT TIME ZONE 'UTC'` relabels each already-stored naive value as
 * UTC without altering its digits. It does not retroactively correct any
 * rows that were skewed by the pre-fix bug; if this deployment's host ran
 * in a non-UTC timezone, audit in-flight `issuing` rows and consider
 * reinterpreting the backlog `AT TIME ZONE '<host-zone>'` instead. Any
 * skewed `leaseExpiresAt` self-heals within one host-offset window after
 * this migration runs (the lease either has already expired or will expire
 * shortly, allowing a legitimate reclaim).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class FixInvoiceRecordsTimestampTz1818000000006 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoice_records"
        ALTER COLUMN "leaseExpiresAt" TYPE timestamptz USING "leaseExpiresAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "issuedAt"       TYPE timestamptz USING "issuedAt"       AT TIME ZONE 'UTC',
        ALTER COLUMN "createdAt"      TYPE timestamptz USING "createdAt"      AT TIME ZONE 'UTC',
        ALTER COLUMN "updatedAt"      TYPE timestamptz USING "updatedAt"      AT TIME ZONE 'UTC'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoice_records"
        ALTER COLUMN "leaseExpiresAt" TYPE timestamp WITHOUT TIME ZONE USING "leaseExpiresAt" AT TIME ZONE 'UTC',
        ALTER COLUMN "issuedAt"       TYPE timestamp WITHOUT TIME ZONE USING "issuedAt"       AT TIME ZONE 'UTC',
        ALTER COLUMN "createdAt"      TYPE timestamp WITHOUT TIME ZONE USING "createdAt"      AT TIME ZONE 'UTC',
        ALTER COLUMN "updatedAt"      TYPE timestamp WITHOUT TIME ZONE USING "updatedAt"      AT TIME ZONE 'UTC'
    `);
  }
}

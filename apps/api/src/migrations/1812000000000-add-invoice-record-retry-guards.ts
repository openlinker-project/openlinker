/**
 * Add Invoice Record Retry Guards Migration (#1200)
 *
 * Closes the R2/R3 exactly-once gaps on `invoice_records`:
 *   - `failureMode` (nullable text): the neutral failure discriminator
 *     (`rejected` | `in-doubt`). Set on a `failed` outcome so the read-gate can
 *     re-attempt a terminal `rejected` row but never an `in-doubt` one (a
 *     document may already exist). `null` for non-`failed` rows.
 *   - `leaseExpiresAt` (nullable timestamp): the expiry of the `issuing` CAS
 *     lease. Set when an attempt claims the in-flight slot; `null` otherwise.
 *     Backs the atomic `claimForIssue` guard that lets exactly one concurrent
 *     same-key retry cross the provider boundary.
 *   - `failureCode` (nullable varchar) + `failureReason` (nullable text) (W1):
 *     the machine-readable failure code (closed neutral taxonomy) + a short,
 *     PII-free reason. Both surface on the response DTO so the FE can tell a
 *     re-attemptable `rejected` failure from an unsafe `in-doubt` one without
 *     parsing the INTERNAL-ONLY `errorMessage`. `null` for non-`failed` rows.
 *
 * Column identifiers stay camelCase-quoted (matching `failureMode` /
 * `leaseExpiresAt` above and the TypeORM-default column naming on the ORM entity);
 * a snake_case name would break the entity↔column mapping.
 *
 * The `status` column gains a new logical value `issuing` (no DB enum — it is a
 * plain text column, so no type change is required). The partial-unique create
 * guard `UQ_invoice_records_connection_idempotency` is unchanged: these columns
 * ADD retry-path guards alongside it.
 *
 * Generated: 2026-06-25 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInvoiceRecordRetryGuards1812000000000 implements MigrationInterface {
  name = 'AddInvoiceRecordRetryGuards1812000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "failureMode" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "failureCode" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" ADD COLUMN IF NOT EXISTS "failureReason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "failureReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "failureCode"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "leaseExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_records" DROP COLUMN IF EXISTS "failureMode"`,
    );
  }
}

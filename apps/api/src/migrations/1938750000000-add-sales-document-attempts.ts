/**
 * Add Sales Document Attempts
 *
 * Adds `attempt` and `previousAttemptId` to `fiscal_registration_records` and
 * `invoice_records` (#3960).
 *
 * A document the provider refused can now be asked for again as a NEW attempt:
 * its own record under its own key (`{root}:r{n}`). Re-sending under the refused
 * key did nothing useful, because a provider that keeps one document per key
 * answers it with the document it already refused.
 *
 * - `attempt int NOT NULL DEFAULT 0`: every existing row is a first attempt,
 *   which is exactly what it is. No backfill beyond the default.
 * - `previousAttemptId uuid NULL` with a self-referencing FK (`ON DELETE SET
 *   NULL`, so deleting an old attempt never cascades into a newer one).
 * - A partial unique index on `previousAttemptId`: a refused attempt has at most
 *   one successor. The per-order lock already serialises retries; this is the
 *   database backstop behind it.
 *
 * `IF NOT EXISTS` / `IF EXISTS` keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

const TABLES = [
  { table: 'fiscal_registration_records', index: 'UQ_fiscal_registration_records_previous_attempt' },
  { table: 'invoice_records', index: 'UQ_invoice_records_previous_attempt' },
] as const;

export class AddSalesDocumentAttempts1938750000000 implements MigrationInterface {
  name = 'AddSalesDocumentAttempts1938750000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, index } of TABLES) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "attempt" integer NOT NULL DEFAULT 0`
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "previousAttemptId" uuid`
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_previous_attempt"`
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "FK_${table}_previous_attempt" ` +
          `FOREIGN KEY ("previousAttemptId") REFERENCES "${table}"("id") ON DELETE SET NULL`
      );
      await queryRunner.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS "${index}" ON "${table}" ("previousAttemptId") ` +
          `WHERE "previousAttemptId" IS NOT NULL`
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, index } of TABLES) {
      await queryRunner.query(`DROP INDEX IF EXISTS "${index}"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_previous_attempt"`
      );
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "previousAttemptId"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "attempt"`);
    }
  }
}

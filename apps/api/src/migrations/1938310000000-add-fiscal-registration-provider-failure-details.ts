/**
 * Add Fiscal Registration Provider Failure Details
 *
 * Adds a nullable `providerFailureDetails` jsonb column to
 * `fiscal_registration_records` (#3843): the PII-free identifiers of a
 * provider's refusal (its own error code, the fiscal device's code, its id for
 * the attempt and an adapter-composed hint), so an operator can look a failure
 * up or quote it to support. Until now those identifiers existed only in the
 * internal `errorMessage`, which is never returned to an API caller.
 *
 * Nullable, no default, no backfill: a record written before this column has
 * no structured details, and recovering them by parsing `errorMessage` would
 * be exactly the message-parsing the structured field exists to avoid. Such a
 * record keeps rendering the plain failure sentence it always did.
 *
 * `IF NOT EXISTS` / `IF EXISTS` keep up/down idempotent.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFiscalRegistrationProviderFailureDetails1938310000000
  implements MigrationInterface
{
  name = 'AddFiscalRegistrationProviderFailureDetails1938310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fiscal_registration_records" ADD COLUMN IF NOT EXISTS "providerFailureDetails" jsonb`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fiscal_registration_records" DROP COLUMN IF EXISTS "providerFailureDetails"`
    );
  }
}

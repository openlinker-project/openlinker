/**
 * Add Offer-Creation-Record Request Payload Column
 *
 * Adds a nullable `request` jsonb column to `offer_creation_records` that
 * persists a snapshot of the original create-offer request payload (#307).
 * Enables the wizard's retry-prefill path: on a failed record, operators
 * click Retry and re-open the wizard with the prior fields pre-populated
 * plus a fresh idempotency key.
 *
 * Additive and null-for-old-rows by design. Records predating this change
 * have `request IS NULL` and degrade gracefully on the FE (retry still
 * opens the wizard, pre-filling only `connectionId` and `internalVariantId`
 * from columns already on the record).
 *
 * Generated manually: Docker was not available at generation time, so the
 * SQL is hand-written here rather than going through `migration:generate`.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferCreationRecordRequestPayload1787000000000 implements MigrationInterface {
  name = 'AddOfferCreationRecordRequestPayload1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "offer_creation_records" ADD COLUMN IF NOT EXISTS "request" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "offer_creation_records" DROP COLUMN IF EXISTS "request"`,
    );
  }
}

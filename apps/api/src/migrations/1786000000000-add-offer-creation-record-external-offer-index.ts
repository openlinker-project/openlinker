/**
 * Add Offer-Creation-Record External-Offer Partial Index
 *
 * Adds a partial composite index on `offer_creation_records
 * (externalOfferId, connectionId) WHERE externalOfferId IS NOT NULL`. Powers
 * the `findByExternalOfferIdAndConnectionId` lookup used by the listings
 * detail endpoint to embed creation status alongside an offer mapping
 * (issue #306 follow-up to #261).
 *
 * Partial by design: pre-creation rows (status `pending` before the adapter
 * returns) always have null `externalOfferId` and never hit this index path,
 * so indexing them wastes space. The `WHERE` predicate keeps the index
 * narrow and selective.
 *
 * Generated manually: Docker was not available at generation time, so the
 * partial-index SQL is hand-written here rather than going through
 * `migration:generate`.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferCreationRecordExternalOfferIndex1786000000000 implements MigrationInterface {
  name = 'AddOfferCreationRecordExternalOfferIndex1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_offer_creation_records_external_offer_connection"
        ON "offer_creation_records" ("externalOfferId", "connectionId")
        WHERE "externalOfferId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_creation_records_external_offer_connection"`,
    );
  }
}

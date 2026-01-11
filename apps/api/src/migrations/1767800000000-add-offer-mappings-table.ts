/**
 * Migration: Add Offer Mappings Table
 *
 * Creates the offer_mappings table for storing marketplace offer to product mappings.
 * This is a generic table that supports multiple marketplace platforms (Allegro, etc.)
 * without per-platform schema churn.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferMappingsTable1767800000000 implements MigrationInterface {
  name = 'AddOfferMappingsTable1767800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if table already exists (might have been created manually or by a later migration)
    const table = await queryRunner.getTable('offer_mappings');

    if (!table) {
      await queryRunner.query(`
        CREATE TABLE "offer_mappings" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "connectionId" uuid NOT NULL,
          "platformType" character varying NOT NULL,
          "offerId" character varying NOT NULL,
          "internalProductId" character varying NOT NULL,
          "variantId" character varying,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_offer_mappings" PRIMARY KEY ("id")
        )
      `);

      // Unique constraint: one offer per connection (offerId is unique per marketplace)
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_offer_mappings_connection_offer" 
        ON "offer_mappings" ("connectionId", "offerId")
      `);

      // Index for reverse lookup: find all offers for a product
      await queryRunner.query(`
        CREATE INDEX "IDX_offer_mappings_product" 
        ON "offer_mappings" ("internalProductId")
      `);

      // Index for platform type queries
      await queryRunner.query(`
        CREATE INDEX "IDX_offer_mappings_platform" 
        ON "offer_mappings" ("platformType", "connectionId")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_offer_mappings_platform"`);
    await queryRunner.query(`DROP INDEX "IDX_offer_mappings_product"`);
    await queryRunner.query(`DROP INDEX "IDX_offer_mappings_connection_offer"`);
    await queryRunner.query(`DROP TABLE "offer_mappings"`);
  }
}



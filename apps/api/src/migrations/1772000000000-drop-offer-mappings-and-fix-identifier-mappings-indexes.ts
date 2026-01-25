/**
 * Migration: Drop offer_mappings and fix identifier_mappings indexes
 *
 * TL decision: standardize all external→internal mappings (including offers) on identifier_mappings.
 * - Remove offer_mappings table
 * - Ensure external-side uniqueness (already exists in earlier migrations)
 * - Ensure fast reverse lookup by internalId WITHOUT uniqueness on internalId
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropOfferMappingsAndFixIdentifierMappingsIndexes1772000000000
  implements MigrationInterface
{
  name = 'DropOfferMappingsAndFixIdentifierMappingsIndexes1772000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1) Drop legacy offer mappings table (if present)
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_mappings"`);

    // 2) Ensure identifier_mappings does NOT enforce uniqueness on internalId.
    // Older migrations created this as UNIQUE (entityType, internalId) then changed to UNIQUE (entityType, connectionId, internalId).
    // We want NO uniqueness on internalId because many external IDs may map to the same internal ID.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_84b761294149aed081cfba5c95"`);

    // 3) Add non-unique index to speed reverse lookups:
    // inventory propagation often needs: internalId -> offers, scoped by platform/connection
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_identifier_mappings_reverse_lookup"
      ON "identifier_mappings" ("entityType", "platformType", "connectionId", "internalId")
    `);

    // 4) Add a simpler reverse lookup index for the common query shape used by IdentifierMappingService.getExternalIds:
    // SELECT ... WHERE entityType = ? AND internalId = ?
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_identifier_mappings_entity_internal"
      ON "identifier_mappings" ("entityType", "internalId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop added indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_identifier_mappings_entity_internal"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_identifier_mappings_reverse_lookup"`);

    // Restore prior unique index shape (best-effort) to match previous migration state
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_84b761294149aed081cfba5c95"
      ON "identifier_mappings" ("entityType", "connectionId", "internalId")
    `);

    // Re-create offer_mappings table (legacy) for reversibility (best-effort)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "offer_mappings" (
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
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_offer_mappings_connection_offer"
      ON "offer_mappings" ("connectionId", "offerId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offer_mappings_product"
      ON "offer_mappings" ("internalProductId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offer_mappings_platform"
      ON "offer_mappings" ("platformType", "connectionId")
    `);
  }
}


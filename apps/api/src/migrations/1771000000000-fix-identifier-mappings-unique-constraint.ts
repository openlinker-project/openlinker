/**
 * Migration: Fix Identifier Mappings Unique Constraint
 *
 * Changes the unique constraint on identifier_mappings from (entityType, internalId)
 * to (entityType, connectionId, internalId) to support multi-connection identity model.
 *
 * This allows the same internal ID to map to different external IDs across different
 * connections (e.g., same customer in Allegro and PrestaShop), which is required
 * for cross-destination order routing.
 *
 * Generated: 2026-01-11
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixIdentifierMappingsUniqueConstraint1771000000000 implements MigrationInterface {
  name = 'FixIdentifierMappingsUniqueConstraint1771000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop old unique index: (entityType, internalId)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_84b761294149aed081cfba5c95"
    `);

    // Create new unique index: (entityType, connectionId, internalId)
    // Column order: entityType first (most selective), then connectionId (query locality),
    // then internalId (completes uniqueness per connection)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_84b761294149aed081cfba5c95" 
      ON "identifier_mappings" ("entityType", "connectionId", "internalId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop new index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_84b761294149aed081cfba5c95"
    `);

    // Restore old unique index: (entityType, internalId)
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_84b761294149aed081cfba5c95" 
      ON "identifier_mappings" ("entityType", "internalId")
    `);
  }
}

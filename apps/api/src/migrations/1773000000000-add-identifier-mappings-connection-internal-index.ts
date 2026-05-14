/**
 * Migration: Add identifier_mappings connection+internal index
 *
 * Ensures a non-unique reverse lookup index on (entityType, connectionId, internalId)
 * to support fast offer mapping lookups without enforcing uniqueness on internalId.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdentifierMappingsConnectionInternalIndex1773000000000
  implements MigrationInterface
{
  name = 'AddIdentifierMappingsConnectionInternalIndex1773000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure no uniqueness on internalId (best-effort safety)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_84b761294149aed081cfba5c95"
    `);

    // Add reverse lookup index scoped by connection
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_identifier_mappings_connection_internal"
      ON "identifier_mappings" ("entityType", "connectionId", "internalId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_identifier_mappings_connection_internal"
    `);
  }
}

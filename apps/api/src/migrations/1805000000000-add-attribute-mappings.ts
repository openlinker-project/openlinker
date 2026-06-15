/**
 * Migration: add `attribute_mappings` + `attribute_value_mappings` tables
 *
 * Storage for attribute projection (#1038, ADR-023 §4): maps a source product
 * attribute key → a destination parameter name, scoped by source + destination
 * connection with an optional per-category override, plus per-value
 * translations.
 *
 * Index design: Postgres treats NULL ≠ NULL in unique indexes, so the parent
 * ships two partial unique indexes — one for the connection-wide default
 * (`destination_category_id IS NULL`), one for per-category overrides
 * (`destination_category_id IS NOT NULL`). Mirrors the ORM-entity decorators
 * for synchronize↔migration parity. `gen_random_uuid()` is built-in on PG ≥ 13
 * (Testcontainers + prod run PG 16).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttributeMappings1805000000000 implements MigrationInterface {
  name = 'AddAttributeMappings1805000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attribute_mappings" (
        "id"                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "source_connection_id"       UUID         NOT NULL,
        "destination_connection_id"  UUID         NOT NULL,
        "source_attribute_key"       VARCHAR(255) NOT NULL,
        "destination_parameter_name" VARCHAR(255) NOT NULL,
        "destination_category_id"    VARCHAR(100) NULL,
        "created_at"                 TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"                 TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "FK_attribute_mappings_source_connection"
          FOREIGN KEY ("source_connection_id")      REFERENCES "connections"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attribute_mappings_destination_connection"
          FOREIGN KEY ("destination_connection_id") REFERENCES "connections"("id") ON DELETE CASCADE
      )
    `);

    // Connection-wide default: at most one row per (source, destination, key) when no category override.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_attribute_mappings_default"
        ON "attribute_mappings" ("source_connection_id", "destination_connection_id", "source_attribute_key")
        WHERE "destination_category_id" IS NULL
    `);

    // Per-category override: at most one row per (source, destination, key, category) when category is set.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_attribute_mappings_per_category"
        ON "attribute_mappings" ("source_connection_id", "destination_connection_id", "source_attribute_key", "destination_category_id")
        WHERE "destination_category_id" IS NOT NULL
    `);

    // Supports the per-projection getAttributeMappings(destinationConnectionId)
    // read (neither partial unique index is left-prefixed on destination).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IX_attribute_mappings_destination"
        ON "attribute_mappings" ("destination_connection_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attribute_value_mappings" (
        "id"                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "attribute_mapping_id" UUID         NOT NULL,
        "source_value"         VARCHAR(255) NOT NULL,
        "destination_value"    VARCHAR(255) NOT NULL,
        "created_at"           TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "FK_attribute_value_mappings_mapping"
          FOREIGN KEY ("attribute_mapping_id") REFERENCES "attribute_mappings"("id") ON DELETE CASCADE
      )
    `);

    // Unique as an INDEX (not a table constraint) to match the ORM @Index the
    // integration harness builds via synchronize.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_attribute_value_mappings_mapping_source"
        ON "attribute_value_mappings" ("attribute_mapping_id", "source_value")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_attribute_value_mappings_mapping_source"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attribute_value_mappings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IX_attribute_mappings_destination"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_attribute_mappings_per_category"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_attribute_mappings_default"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attribute_mappings"`);
  }
}

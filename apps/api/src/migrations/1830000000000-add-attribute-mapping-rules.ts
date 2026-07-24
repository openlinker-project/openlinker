/**
 * Migration: add `attribute_mapping_rules` table
 *
 * Storage for operator-authored attribute mapping rules (#1841) consumed by
 * attribute projection: fixed / copy-remap / place-value rules that fill a
 * destination parameter/attribute by name, scoped (all optional, AND-combined)
 * by source connection, destination category, manufacturer, and product-name
 * phrase, and ordered by `priority`. Kind-specific configuration lives in the
 * `config` jsonb column; `kind` is mirrored as a scalar for DB-level filtering.
 *
 * The `attribute_mapping_rules.{destination,source}_connection_id` columns and
 * the `IX_attribute_mapping_rules_destination` index mirror the ORM-entity
 * decorators for synchronize↔migration parity. The two `ON DELETE CASCADE`
 * foreign keys to `connections(id)` are intentionally migration-only — the ORM
 * entity deliberately does NOT model them as `@ManyToOne` relations (the rule is
 * read connection-scoped by id and never navigates to the `Connection`
 * aggregate, so a relation would only add eager-load / hydration churn). The
 * synchronize-built integration schema therefore omits the FKs; the DB-level
 * cascade is a production-migration guarantee, not part of the entity contract.
 * `gen_random_uuid()` is built-in on PG >= 13 (Testcontainers + prod run PG 16).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttributeMappingRules1830000000000 implements MigrationInterface {
  name = 'AddAttributeMappingRules1830000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attribute_mapping_rules" (
        "id"                         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        "destination_connection_id"  UUID         NOT NULL,
        "destination_parameter_name" VARCHAR(255) NOT NULL,
        "kind"                       VARCHAR(20)  NOT NULL,
        "config"                     JSONB        NOT NULL,
        "priority"                   INTEGER      NOT NULL DEFAULT 0,
        "source_connection_id"       UUID         NULL,
        "destination_category_id"    VARCHAR(100) NULL,
        "manufacturer_match"         VARCHAR(255) NULL,
        "phrase_match"               VARCHAR(255) NULL,
        "created_at"                 TIMESTAMP    NOT NULL DEFAULT now(),
        "updated_at"                 TIMESTAMP    NOT NULL DEFAULT now(),
        CONSTRAINT "FK_attribute_mapping_rules_destination_connection"
          FOREIGN KEY ("destination_connection_id") REFERENCES "connections"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_attribute_mapping_rules_source_connection"
          FOREIGN KEY ("source_connection_id")      REFERENCES "connections"("id") ON DELETE CASCADE
      )
    `);

    // Supports the per-projection getAttributeMappingRules(destinationConnectionId)
    // read, ordered by priority.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IX_attribute_mapping_rules_destination"
        ON "attribute_mapping_rules" ("destination_connection_id", "priority")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IX_attribute_mapping_rules_destination"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attribute_mapping_rules"`);
  }
}

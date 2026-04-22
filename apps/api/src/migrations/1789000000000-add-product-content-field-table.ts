/**
 * Migration: add `product_content_field` table
 *
 * Creates the draft/base storage for per-product, per-channel (or master)
 * content fields used by the new content/ bounded context (#338).
 *
 * Index design: Postgres treats NULL ≠ NULL in unique indexes, so we ship
 * two partial unique indexes — one constraining the master row uniqueness
 * (`connection_id IS NULL`), one constraining the channel rows
 * (`connection_id IS NOT NULL`). A third non-unique index supports
 * `findByKey`-style lookups by `product_id`.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductContentFieldTable1789000000000 implements MigrationInterface {
  name = 'AddProductContentFieldTable1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is built-in on Postgres ≥ 13. On PG ≤ 12 it requires
    // `CREATE EXTENSION IF NOT EXISTS pgcrypto`. Testcontainers uses PG 16
    // and prod is PG 16+, so we rely on the built-in here.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_content_field" (
        "id"            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "product_id"    TEXT        NOT NULL,
        "connection_id" UUID        NULL,
        "field_key"     TEXT        NOT NULL,
        "draft_value"   TEXT        NULL,
        "base_value"    TEXT        NULL,
        "base_version"  TEXT        NULL,
        "has_conflict"  BOOLEAN     NOT NULL DEFAULT FALSE,
        "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_by"    TEXT        NULL,
        CONSTRAINT "fk_pcf_product"    FOREIGN KEY ("product_id")    REFERENCES "products"("id")    ON DELETE CASCADE,
        CONSTRAINT "fk_pcf_connection" FOREIGN KEY ("connection_id") REFERENCES "connections"("id") ON DELETE CASCADE
      )
    `);

    // Master uniqueness: at most one row per (product_id, field_key) when connection_id is NULL.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_pcf_master"
        ON "product_content_field" ("product_id", "field_key")
        WHERE "connection_id" IS NULL
    `);

    // Channel uniqueness: at most one row per (product_id, connection_id, field_key) when connection_id is set.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_pcf_channel"
        ON "product_content_field" ("product_id", "connection_id", "field_key")
        WHERE "connection_id" IS NOT NULL
    `);

    // Lookup index for the productId-only scan (used by future "show all field rows for a product" reads).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_pcf_product"
        ON "product_content_field" ("product_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_pcf_product"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_pcf_channel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_pcf_master"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "product_content_field"`);
  }
}

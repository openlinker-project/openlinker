/**
 * Neutralise category_mappings (#1036, ADR-023 §2)
 *
 * Renames the Allegro/PrestaShop-named columns to source/destination-neutral
 * shapes, adds `source_connection_id` (nullable) + `destination_taxonomy_provenance`,
 * backfills, and swaps the single `(connection_id, prestashop_category_id)`
 * unique constraint for two partial unique indexes that honour Postgres
 * NULL-distinct semantics on the nullable `source_connection_id`.
 *
 * Backfill: every existing row is Allegro-provenance (default handles it);
 * `source_connection_id` is set to the lone PrestaShop connection *iff exactly
 * one exists* — we cannot invent which source store a historical row came from,
 * so multi-source installs leave it NULL for operator re-mapping.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NeutraliseCategoryMappings1804000000000 implements MigrationInterface {
  name = 'NeutraliseCategoryMappings1804000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Rename columns to neutral shapes (RENAME preserves data + tracking
    //    constraints/indexes on connection_id → destination_connection_id).
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "connection_id" TO "destination_connection_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "prestashop_category_id" TO "source_category_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "allegro_category_id" TO "destination_category_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "allegro_category_name" TO "destination_category_name"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "allegro_category_path" TO "destination_category_path"`
    );

    // 2. New columns.
    await queryRunner.query(
      `ALTER TABLE "category_mappings" ADD COLUMN "source_connection_id" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" ADD COLUMN "destination_taxonomy_provenance" varchar(50) NOT NULL DEFAULT 'allegro'`
    );

    // 3. Backfill source_connection_id from the single PrestaShop connection
    //    (no-op on fresh DBs, and when 0 or >1 PrestaShop connections exist).
    await queryRunner.query(`
      UPDATE "category_mappings"
      SET "source_connection_id" = (
        SELECT c."id" FROM "connections" c WHERE c."platformType" = 'prestashop'
      )
      WHERE (
        SELECT COUNT(*) FROM "connections" c WHERE c."platformType" = 'prestashop'
      ) = 1
    `);

    // 4. FK for the new nullable source connection (mirrors the destination FK).
    await queryRunner.query(`
      ALTER TABLE "category_mappings"
      ADD CONSTRAINT "FK_category_mappings_source_connection"
      FOREIGN KEY ("source_connection_id") REFERENCES "connections"("id") ON DELETE SET NULL
    `);

    // 5. Swap the old single unique for two partial unique indexes (NULL-distinct
    //    on source_connection_id — precedent: product_content_field, prompt_templates).
    await queryRunner.query(
      `ALTER TABLE "category_mappings" DROP CONSTRAINT "UQ_category_mappings_connection_prestashop"`
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_category_mappings_src_dest_cat"
      ON "category_mappings" ("source_connection_id", "destination_connection_id", "source_category_id")
      WHERE "source_connection_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_category_mappings_dest_cat_nullsrc"
      ON "category_mappings" ("destination_connection_id", "source_category_id")
      WHERE "source_connection_id" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_category_mappings_dest_cat_nullsrc"`);
    await queryRunner.query(`DROP INDEX "UQ_category_mappings_src_dest_cat"`);
    await queryRunner.query(
      `ALTER TABLE "category_mappings" DROP CONSTRAINT "FK_category_mappings_source_connection"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" DROP COLUMN "destination_taxonomy_provenance"`
    );
    await queryRunner.query(`ALTER TABLE "category_mappings" DROP COLUMN "source_connection_id"`);

    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "destination_category_path" TO "allegro_category_path"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "destination_category_name" TO "allegro_category_name"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "destination_category_id" TO "allegro_category_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "source_category_id" TO "prestashop_category_id"`
    );
    await queryRunner.query(
      `ALTER TABLE "category_mappings" RENAME COLUMN "destination_connection_id" TO "connection_id"`
    );

    await queryRunner.query(`
      ALTER TABLE "category_mappings"
      ADD CONSTRAINT "UQ_category_mappings_connection_prestashop"
      UNIQUE ("connection_id", "prestashop_category_id")
    `);
  }
}

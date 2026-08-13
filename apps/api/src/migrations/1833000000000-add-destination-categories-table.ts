/**
 * Add `destination_categories` table (#1979, ADR-037)
 *
 * The neutral destination-taxonomy projection. Hand-authored rather than
 * generated: `migration:generate` emits neither the two PARTIAL unique indexes
 * (uniqueness spans a nullable key) nor a GIN index with an operator class.
 *
 * Timestamp is a synthetic sequential prefix per `docs/migrations.md`
 * § Timestamp uniqueness invariant — the tail on `main` was `1832000000008`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDestinationCategoriesTable1833000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    // Provisioned for the `searchText LIKE '%…%'` predicate via gin_trgm_ops.
    //
    // MEASURED, so the expectation stays honest: at ~20k rows (roughly one
    // Allegro tree) the planner prefers a Seq Scan (cost 558) over this index
    // (cost 1188) — it is only chosen with `enable_seqscan=off`. Real queries
    // also filter by scope, which narrows further and favours the scan more. It
    // is kept because the table holds EVERY scope's rows (each marketplace owner
    // and each shop connection adds a tree), so the row count grows past the
    // crossover with the installation; drop it if that never materialises.
    //
    // Correctness does NOT depend on it — the repository deliberately uses LIKE
    // rather than the `%` similarity operator, which would error outright where
    // the extension is unavailable (e.g. the synchronize-built test schema).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      CREATE TABLE "destination_categories" (
        "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
        "taxonomyOwner"  text,
        "connectionId"   uuid,
        "externalId"     text NOT NULL,
        "name"           text NOT NULL,
        "parentId"       text,
        "leaf"           boolean,
        "searchText"     text NOT NULL,
        "syncedAt"       TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"      TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_destination_categories" PRIMARY KEY ("id")
      )
    `);

    // Exactly one of the two scope columns is non-null (ADR-037). Postgres
    // treats NULLs as distinct, so a single composite unique index would not
    // prevent duplicates — hence two partial ones, the same NULL-distinct
    // pattern `product_content_field` uses for its master-vs-channel split.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_destination_categories_owner_external"
        ON "destination_categories" ("taxonomyOwner", "externalId")
        WHERE "taxonomyOwner" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_destination_categories_connection_external"
        ON "destination_categories" ("connectionId", "externalId")
        WHERE "connectionId" IS NOT NULL
    `);

    // Level reads (`browse`), one per scope column.
    await queryRunner.query(`
      CREATE INDEX "IDX_destination_categories_owner_parent"
        ON "destination_categories" ("taxonomyOwner", "parentId")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_destination_categories_connection_parent"
        ON "destination_categories" ("connectionId", "parentId")
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_destination_categories_searchText_trgm"
        ON "destination_categories" USING GIN ("searchText" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_destination_categories_searchText_trgm"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_destination_categories_connection_parent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_destination_categories_owner_parent"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_destination_categories_connection_external"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_destination_categories_owner_external"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "destination_categories"`);
    // Extensions are intentionally NOT dropped — they may be shared.
  }
}

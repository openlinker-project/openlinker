/**
 * Unify the sales-document country default to one row per country (#3177)
 *
 * `sales_document_country_defaults` was unique on `(country, document_kind)`,
 * so a country could hold BOTH an invoice default and a receipt default at
 * once. That state was never useful — `evaluateSalesDocumentRules` reads two
 * defaults for one country as `ambiguous-defaults` -> `unresolved`, so an
 * order that matched no rule was held with no fallback taken, exactly as if
 * neither default existed. The FE only detected and explained the
 * contradiction after the fact; this migration makes it unexpressible by
 * moving uniqueness onto `country` ALONE (matching the ORM entity's
 * `@Index('UQ_sales_document_country_defaults_country', ['country'], {
 * unique: true })`).
 *
 * Three steps, in the order that keeps each one safe on its own:
 *
 *   1. Dedupe — for any country currently carrying more than one row (which,
 *      under the old two-document-kind vocabulary, means exactly two: one
 *      invoice default and one receipt default), keep the most recently
 *      updated row and delete the rest. "Most recently updated" is the
 *      closest available proxy for "the one the operator actually meant" —
 *      there is no other signal on the row to prefer one kind over the
 *      other, and the pre-existing behaviour was already indistinguishable
 *      from having neither, so this can only ever fix a previously-broken
 *      fallback, never regress a working one.
 *   2. Drop the old `(country, document_kind)` unique index.
 *   3. Create the new `(country)` unique index under its final name.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class UnifySalesDocumentCountryDefaultPerCountry1881000000001
  implements MigrationInterface
{
  name = 'UnifySalesDocumentCountryDefaultPerCountry1881000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Keep exactly one row per `country` — the most recently updated,
    // ties broken by `id` so the statement is deterministic even when two
    // rows share an `updated_at` instant.
    //
    // The losing row is a fiscal-routing setting an operator chose, so the
    // delete names what it dropped rather than being silent — the `DO $$ ...
    // RAISE NOTICE` shape `1788000000001-rename-marketplace-capability`
    // already uses for a migration-log breadcrumb. It cannot be reconstructed
    // from the surviving row (see `down()`), so the migration log is the only
    // record of it that exists afterwards.
    await queryRunner.query(`
      DO $$
      DECLARE removed_pairs text;
      BEGIN
        WITH ranked AS (
          SELECT "id",
                 ROW_NUMBER() OVER (
                   PARTITION BY "country"
                   ORDER BY "updated_at" DESC, "id" DESC
                 ) AS rn
          FROM "sales_document_country_defaults"
        ), removed AS (
          DELETE FROM "sales_document_country_defaults"
          WHERE "id" IN (SELECT "id" FROM ranked WHERE rn > 1)
          RETURNING "country", "document_kind"
        )
        SELECT string_agg(
                 '(' || "country" || ', ' || "document_kind" || ')',
                 ', ' ORDER BY "country", "document_kind"
               )
          INTO removed_pairs
          FROM removed;

        IF removed_pairs IS NOT NULL THEN
          RAISE NOTICE
            '[#3177] Dropped the superseded sales-document country default(s) %. A country now holds at most one default; the most recently updated row was kept.',
            removed_pairs;
        END IF;
      END$$;
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_sales_document_country_defaults_country_kind"`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_document_country_defaults_country"
        ON "sales_document_country_defaults" ("country")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_sales_document_country_defaults_country"`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_sales_document_country_defaults_country_kind"
        ON "sales_document_country_defaults" ("country", "document_kind")
    `);

    // The dedup step in up() is intentionally NOT reversed. Rows it deleted
    // are gone, and there is nothing left on the surviving row to
    // reconstruct the one that was removed — the same "the forward fix is
    // what re-derives this, not a rollback" posture as
    // `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders`'s
    // own `down()`. Restoring the old index only re-admits the SHAPE that
    // used to allow two rows per country; it does not and cannot re-create
    // the second row this migration removed.
  }
}

/**
 * Add `order_records.searchText` + trigram index (#3527)
 *
 * Hand-authored: `migration:generate` emits neither the GIN index with an
 * operator class nor the jsonb-derived backfill.
 *
 * The `searchText` column is the denormalized, diacritic-folded corpus
 * `deriveOrderSearchText` computes on every write (order number, buyer name,
 * buyer email, every line SKU) — the `DestinationCategory.searchText`
 * precedent (`1833000000000-add-destination-categories-table.ts`).
 *
 * Two things this migration does that the ongoing TS write path does not:
 *
 * 1. It BACKFILLS every pre-existing row. The ongoing writer only ever runs on
 *    a write, so a row nobody re-ingests after this deploy would carry `''`
 *    forever and be permanently unsearchable.
 * 2. The backfill uses the `unaccent` PostgreSQL extension rather than the
 *    JS `deriveOrderSearchText` normalization (an UPDATE cannot call
 *    application code). The two normalizations are NOT guaranteed
 *    byte-identical on every input (in particular the `ł`/`ø`/`ß`-class
 *    letters `unaccent` does not decompose either — see
 *    `destination-category-search.ts`'s own docblock for that exact trap) —
 *    accepted as a one-time backfill approximation; every row touched by a
 *    write AFTER this deploy gets the exact JS-normalized value.
 *
 * Timestamp is this epic's synthetic block (#3507): 1912000000000 -
 * 1912999999999. The tail on `main` at authoring time was `1901000000000`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSearchText1912000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Provisioned for the `searchText LIKE '%…%'` predicate via gin_trgm_ops —
    // same reasoning as `1833000000000-add-destination-categories-table.ts`.
    // Correctness does NOT depend on it: the repository matches with `LIKE`,
    // never the `%` similarity operator, which would error where the
    // extension is unavailable (e.g. the synchronize-built test schema).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    // `unaccent` backs the ONE-TIME backfill below only — never a live query
    // path, and never an index expression (it is STABLE, not IMMUTABLE, so
    // Postgres would refuse it there regardless).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD COLUMN "searchText" text NOT NULL DEFAULT ''
    `);

    // Backfill every existing row from its already-stored jsonb snapshot.
    // Mirrors `deriveOrderSearchText`'s corpus (order number, buyer email,
    // billing/shipping first+last name, every line sku) — see this file's
    // class docblock for why the normalization is an approximation here.
    await queryRunner.query(`
      UPDATE "order_records"
      SET "searchText" = lower(unaccent(trim(both ' ' from (
        coalesce("orderSnapshot"->>'orderNumber', '') || ' ' ||
        coalesce("orderSnapshot"->>'customerEmail', '') || ' ' ||
        coalesce("orderSnapshot"->'billingAddress'->>'firstName', '') || ' ' ||
        coalesce("orderSnapshot"->'billingAddress'->>'lastName', '') || ' ' ||
        coalesce("orderSnapshot"->'shippingAddress'->>'firstName', '') || ' ' ||
        coalesce("orderSnapshot"->'shippingAddress'->>'lastName', '') || ' ' ||
        coalesce((
          SELECT string_agg(item->>'sku', ' ')
          FROM jsonb_array_elements("orderSnapshot"->'items') AS item
          WHERE jsonb_typeof("orderSnapshot"->'items') = 'array'
            AND item->>'sku' IS NOT NULL
        ), '')
      ))))
      WHERE "orderSnapshot" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_order_records_searchText_trgm"
        ON "order_records" USING GIN ("searchText" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_searchText_trgm"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "searchText"`);
    // Extensions are intentionally NOT dropped — they may be shared.
  }
}

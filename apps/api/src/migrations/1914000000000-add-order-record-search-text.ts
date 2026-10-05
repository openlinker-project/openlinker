/**
 * Add `order_records.searchText` + trigram index (#3527)
 *
 * Hand-authored: `migration:generate` does not emit a GIN index with an
 * operator class.
 *
 * The `searchText` column is the denormalized, diacritic-folded corpus
 * `deriveOrderSearchText` (`libs/core/src/orders/domain/order-search-text.ts`)
 * computes on every write (order number, buyer name, buyer email, every line
 * SKU) — the `DestinationCategory.searchText` precedent
 * (`1833000000000-add-destination-categories-table.ts`).
 *
 * **There is deliberately no backfill here.** Existing rows keep the column
 * default `''` until `1914000007000-recompute-order-record-search-text.ts`,
 * which re-derives every row under the CURRENT `OL_STORE_PII` setting — a
 * strict superset of anything a backfill here could do. A backfill in this
 * migration could not honour that flag without duplicating the recompute, and
 * one that ignored it would write buyer names and emails into this new
 * plaintext column (and the WAL) on an `OL_STORE_PII=false` install, where
 * they would stay if the run stopped anywhere before the recompute. The
 * column and index are created here; the data is written once, there.
 *
 * Every DDL statement is guarded (`IF NOT EXISTS`, `docs/migrations.md`): this
 * migration was renumbered from `1912000000000` (#3633 review — `main` took
 * that prefix), so TypeORM, which decides pending by class name, re-runs it on
 * any database that applied it under its old name.
 *
 * Timestamp is this epic's synthetic block (#3507): 1914000000000 -
 * 1914999999999, above `main`'s `1912000000000` tail and #3631's
 * `1913000000000`–`1913000000002`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordSearchText1914000000000 implements MigrationInterface {
  name = 'AddOrderRecordSearchText1914000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Provisioned for the `searchText LIKE '%…%'` predicate via gin_trgm_ops —
    // same reasoning as `1833000000000-add-destination-categories-table.ts`.
    // Correctness does NOT depend on it: the repository matches with `LIKE`,
    // never the `%` similarity operator, which would error where the
    // extension is unavailable (e.g. the synchronize-built test schema).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);

    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD COLUMN IF NOT EXISTS "searchText" text NOT NULL DEFAULT ''
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_searchText_trgm"
        ON "order_records" USING GIN ("searchText" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_searchText_trgm"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "searchText"`);
    // The `pg_trgm` extension is intentionally NOT dropped — it may be shared
    // with `DestinationCategory.searchText`'s own trigram index.
  }
}

/**
 * Add the FX rate registry, the reporting-currency setting and the
 * `order_records` FX snapshot (#2122 / #2123 / #2124, ADR-040)
 *
 * Three things land together because they are one schema unit: the shared
 * `exchange_rates` registry, the singleton `reporting_currency_setting` row the
 * reporting currency resolves from, and the six `order_records` columns that
 * carry a per-order stamp referencing a registry row. #2123 shipped the two ORM
 * entities WITHOUT DDL and deliberately deferred it here, so this is the first
 * migration that creates either table.
 *
 * Hand-authored rather than generated: `migration:generate` emits neither the
 * expression index nor the two CHECK constraints, and would also re-emit a
 * `timestamp without time zone` for the `timestamptz` columns.
 *
 * Timestamp is a synthetic sequential prefix per `docs/migrations.md`
 * § Timestamp uniqueness invariant — the tail on `main` is `1835000000000`
 * (`create-fiscal-registration-records`, #2137), so `1836000000000` is strictly
 * greater and uncontested. This migration sat at `1834000000000` until the
 * fiscalization stack landed on `main` ahead of it and took `1835000000000`;
 * re-prefixed on the merge rather than left below `main`'s tail.
 * `gen_random_uuid()` is built-in on PG >= 13 (Testcontainers + prod run PG 16).
 *
 * NOTE ON NAMING: `exchange_rates` and the `order_records` additions use quoted
 * camelCase columns (matching `order_records`), while
 * `reporting_currency_setting` uses snake_case (matching the three existing
 * singleton settings tables, whose ORM entities carry explicit `name:`). Each
 * table follows the convention of the family it belongs to; do not unify them.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderFxStamp1836000000000 implements MigrationInterface {
  name = 'AddOrderFxStamp1836000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── The shared, APPEND-ONLY rate registry (#2122) ──────────────────────
    // Keyed `(source, fromCurrency, toCurrency, rateDate)`, so five hundred EUR
    // orders on one day resolve to ONE row. `rate` is `numeric(18,8)` and is
    // read back as a string end-to-end - routing an audited figure through a
    // binary float would lose the guarantee that what we stored is what we
    // report. `derivation` is NOT NULL: a direct rate records
    // `{"kind":"direct","legs":[...]}`, so a consumer never has to guess
    // whether an empty column means "direct" or "unknown".
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "exchange_rates" (
        "id"             uuid         NOT NULL DEFAULT gen_random_uuid(),
        "source"         varchar(16)  NOT NULL,
        "fromCurrency"   varchar(3)   NOT NULL,
        "toCurrency"     varchar(3)   NOT NULL,
        "rateDate"       date         NOT NULL,
        "rate"           numeric(18,8) NOT NULL,
        "sourceRef"      text,
        "pivotCurrency"  varchar(3),
        "derivation"     jsonb        NOT NULL,
        "fetchedAt"      timestamptz  NOT NULL DEFAULT now(),
        CONSTRAINT "PK_exchange_rates" PRIMARY KEY ("id"),
        CONSTRAINT "ck_exchange_rates_source" CHECK ("source" IN ('nbp', 'ecb'))
      )
    `);

    // The registry's natural key. This is what makes the get-or-create
    // idempotent: a concurrent second insert for the same key raises PG 23505,
    // which the repository translates into re-selecting the winner.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_exchange_rates_key"
        ON "exchange_rates" ("source", "fromCurrency", "toCurrency", "rateDate")
    `);

    // ── The system-level reporting-currency setting (#2123) ────────────────
    // Singleton row (`id = 'singleton'`), matching
    // `1792000000000-add-ai-provider-active-setting.ts`.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "reporting_currency_setting" (
        "id" text NOT NULL,
        "reporting_currency" varchar(3) NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_reporting_currency_setting" PRIMARY KEY ("id")
      )
    `);

    // ── The per-order FX snapshot (#2124) ─────────────────────────────────
    // All six nullable: every pre-feature row is legitimately unstamped, and
    // "unstamped" must stay a queryable fact distinct from "no conversion was
    // needed" (which is `exchangeRateId IS NULL` with `reportingCurrency` set).
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "reportingCurrency" varchar(3)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "reportingTotalAmount" numeric(12,2)`
    );
    // No FK and no index on "exchangeRateId", deliberately: `order_records` has
    // zero FKs today, and the analytics join lands on `exchange_rates`' own PK,
    // so an index on the referencing side buys nothing for that direction.
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "exchangeRateId" uuid`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fxRule" varchar(32)`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fxStampedAt" timestamptz`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" ADD COLUMN IF NOT EXISTS "fxIntendedCurrency" varchar(3)`
    );

    // PARTIAL COMPOSITE, not a standalone index on "reportingCurrency": that
    // column carries 1-3 distinct values, so a single-column btree is not
    // selective enough for the planner to prefer over a sequential scan, and
    // the existing "IDX_..._sourceConnectionId" already covers the filter half.
    // The composite serves the real analytics shape (filter by connection,
    // group by reporting currency) and the predicate keeps every unstamped row
    // out of the index. Mirrors the @Index on the ORM entity, so the
    // synchronize-built test schema and this migration agree.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_reporting"
        ON "order_records" ("sourceConnectionId", "reportingCurrency")
        WHERE "reportingCurrency" IS NOT NULL
    `);

    // Expression index for `listDistinctNativeCurrencies`. The
    // `jsonb_typeof(...) = 'string'` guard is NOT optional decoration: the
    // repository query carries the identical guarded expression (a malformed
    // snapshot value must read as NULL rather than fail the whole read), and an
    // index expression that did not match it verbatim would never be used.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_order_records_snapshot_currency"
        ON "order_records" (
          (CASE WHEN jsonb_typeof("orderSnapshot"#>'{totals,currency}') = 'string'
                THEN "orderSnapshot"#>>'{totals,currency}' END)
        )
    `);

    // Group integrity, so the six columns cannot drift into a meaningless
    // combination. Read the first arm carefully:
    //
    //   THE FIRST ARM DELIBERATELY OMITS `"fxRule" IS NULL`, AND THAT OMISSION
    //   IS LOAD-BEARING. `claimFxIntentIfAbsent` writes "fxRule" alongside
    //   "fxIntendedCurrency" while "reportingCurrency" is still NULL, so
    //   requiring "fxRule" to be NULL here would reject every intent row and
    //   make the whole snapshot unimplementable. "fxIntendedCurrency" is
    //   likewise unconstrained - it is orthogonal to whether a stamp landed.
    //
    // "exchangeRateId" is not required by the second arm either: it is
    // legitimately NULL on the same-currency path.
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP CONSTRAINT IF EXISTS "ck_order_records_fx_group"`
    );
    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD CONSTRAINT "ck_order_records_fx_group" CHECK (
          ("reportingCurrency" IS NULL AND "reportingTotalAmount" IS NULL AND "exchangeRateId" IS NULL)
          OR ("reportingCurrency" IS NOT NULL AND "reportingTotalAmount" IS NOT NULL AND "fxRule" IS NOT NULL)
        )
    `);

    // Union enforcement on the rule, so a typo cannot become an unqueryable
    // row. One extra migration line per future rule member is the cost.
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP CONSTRAINT IF EXISTS "ck_order_records_fx_rule"`
    );
    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD CONSTRAINT "ck_order_records_fx_rule" CHECK (
          "fxRule" IS NULL OR "fxRule" IN ('prev-business-day')
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP CONSTRAINT IF EXISTS "ck_order_records_fx_rule"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP CONSTRAINT IF EXISTS "ck_order_records_fx_group"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_snapshot_currency"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_records_reporting"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fxIntendedCurrency"`
    );
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fxStampedAt"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "fxRule"`);
    await queryRunner.query(`ALTER TABLE "order_records" DROP COLUMN IF EXISTS "exchangeRateId"`);
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "reportingTotalAmount"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_records" DROP COLUMN IF EXISTS "reportingCurrency"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "reporting_currency_setting"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_exchange_rates_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "exchange_rates"`);
  }
}

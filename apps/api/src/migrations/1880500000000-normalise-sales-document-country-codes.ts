/**
 * Normalise sales-document country codes to uppercase (#3176)
 *
 * The write path (`SalesDocumentRulesService`) now upper-cases every country
 * string before it reaches `sales_document_rules`, `sales_document_country_defaults`
 * and `sales_document_country_acknowledgments`, mirroring
 * `LocationService.normaliseCountry`. Nothing enforced that before this
 * release, so an install that authored a rule or a country default with a
 * lowercase (or mixed-case) country code carries a row this migration would
 * otherwise leave permanently unreachable by the now-normalised read path —
 * `SalesDocumentRulesService.resolveRouting` always looks up the UPPERCASED
 * country going forward, so a stray-case row would silently stop matching any
 * order rather than merely stop being newly created.
 *
 * ORDER data is deliberately NOT touched here. `order_records.orderSnapshot`
 * is a verbatim copy of what the source reported (ADR-014); rewriting it
 * would misstate what a connector actually sent. The read side already
 * folds a lowercase delivery-address country into the same market as its
 * uppercase sibling via `OrderRecordRepository.ROUTING_COUNTRY_EXPR`'s
 * `upper(...)` wrap (this issue, same PR) — that alone accounts for the
 * observed "pl" market with orders and no configuration, with no migration
 * needed for it.
 *
 * `sales_document_rules.conditions` is deliberately NOT touched either, even
 * though an `orderCountry` condition carries a country code of its own
 * (review finding 2). That value is folded at COMPARISON time by
 * `evaluateSalesDocumentRules` instead, because `conditions_hash` is a
 * SHA-256 over a canonical JSON form computed in application code and is a
 * column of `UQ_sales_document_rules_country_hash_from`: SQL could rewrite the
 * value but could not recompute the hash, and a row whose hash no longer
 * describes its own conditions would silently drop out of the write-path
 * conflict guard's `findByCountryAndConditionsHash` candidate pool.
 *
 * SAFE BY CONSTRUCTION, NOT BY ASSUMPTION: each `UPDATE` ranks the whole
 * FOLDING SET — every row whose uppercased country lands in the same
 * uniqueness scope, stray-case and already-uppercase alike — and rewrites only
 * the rank-1 row of each set (`sales_document_country_acknowledgments`'s
 * primary key is the country itself; `sales_document_rules` is unique on
 * `(country, conditions_hash, effective_from)`;
 * `sales_document_country_defaults` is unique on `(country, document_kind)`).
 * Ranking rather than probing for a pre-existing uppercase sibling is what
 * makes the guard hold for TWO stray-case rows that fold onto each other
 * (`pl` and `Pl`): `UPDATE` evaluates its `WHERE` against the pre-statement
 * snapshot, so a `NOT EXISTS` sub-select looking for an already-uppercase row
 * finds neither of them, both rows update, and the statement aborts on the
 * unique constraint. The ordering puts an already-uppercase row first, so a
 * stray-case row never displaces a row that already occupies the target scope.
 *
 * A skipped row is left in its original case rather than merged or deleted —
 * this migration has no way to know which of two same-scope rows an operator
 * would want to keep, and guessing on a fiscal-routing rule is worse than
 * leaving a known-stray row for a human to resolve. Each skipped row is
 * reported by a `RAISE NOTICE` naming the table and the surviving casings
 * (review finding 4), so "leave it for a human" actually reaches one. The
 * countries listing folds on read (`listConfiguredCountries`), so a skipped
 * row cannot render a second market card in the meantime. No environment
 * audited during this issue's design carried such a collision (the observed
 * duplicate market had zero rules and zero defaults under either casing).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The three operator-authored tables `up()` rewrites, in rewrite order. */
/**
 * Each table paired with the REST of its uniqueness key beyond `country` — what
 * the skip report needs to name both sides of a collision rather than only the
 * stray row (review finding). Empty for the acknowledgments table, whose primary
 * key is `country` alone.
 */
const SKIP_REPORTED_TABLES = [
  { table: 'sales_document_country_acknowledgments', keyRest: [] },
  { table: 'sales_document_country_defaults', keyRest: ['document_kind'] },
  { table: 'sales_document_rules', keyRest: ['conditions_hash', 'effective_from'] },
] as const;

export class NormaliseSalesDocumentCountryCodes1880500000000 implements MigrationInterface {
  name = 'NormaliseSalesDocumentCountryCodes1880500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // `country` IS the primary key here, so the folding set is partitioned on
    // the uppercased country alone and joined back on the same column.
    await queryRunner.query(`
      WITH ranked AS (
        SELECT a."country" AS original_country,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(a."country")
                 ORDER BY (a."country" = UPPER(a."country")) DESC,
                          a."acknowledged_at" ASC,
                          a."country" ASC
               ) AS rn
        FROM "sales_document_country_acknowledgments" a
      )
      UPDATE "sales_document_country_acknowledgments" a
      SET "country" = UPPER(a."country")
      FROM ranked
      WHERE ranked.original_country = a."country"
        AND ranked.rn = 1
        AND a."country" <> UPPER(a."country")
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT d."id" AS row_id,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(d."country"), d."document_kind"
                 ORDER BY (d."country" = UPPER(d."country")) DESC,
                          d."created_at" ASC,
                          d."id" ASC
               ) AS rn
        FROM "sales_document_country_defaults" d
      )
      UPDATE "sales_document_country_defaults" d
      SET "country" = UPPER(d."country")
      FROM ranked
      WHERE ranked.row_id = d."id"
        AND ranked.rn = 1
        AND d."country" <> UPPER(d."country")
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT r."id" AS row_id,
               ROW_NUMBER() OVER (
                 PARTITION BY UPPER(r."country"), r."conditions_hash", r."effective_from"
                 ORDER BY (r."country" = UPPER(r."country")) DESC,
                          r."created_at" ASC,
                          r."id" ASC
               ) AS rn
        FROM "sales_document_rules" r
      )
      UPDATE "sales_document_rules" r
      SET "country" = UPPER(r."country")
      FROM ranked
      WHERE ranked.row_id = r."id"
        AND ranked.rn = 1
        AND r."country" <> UPPER(r."country")
    `);

    // Every row the ranking could safely rewrite has been rewritten, so what
    // still carries a stray-case country is exactly the skipped set.
    for (const { table, keyRest } of SKIP_REPORTED_TABLES) {
      await this.reportSkippedRows(queryRunner, table, keyRest);
    }
  }

  public async down(): Promise<void> {
    // Intentionally a no-op, mirroring
    // `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.ts`.
    // Case-folding an ISO-3166-1 alpha-2 code loses no information there is
    // anything meaningful to restore, and no row is ever deleted or merged by
    // `up()` (a row that would collide is left untouched) — there is nothing
    // for `down()` to reverse.
  }

  /**
   * Emit one `RAISE NOTICE` per table that still holds a stray-case country
   * after `up()`'s rewrites. The docblock defers a collision to a human; without
   * this the human is never told the row exists.
   *
   * It names BOTH sides of each collision — the stray value and the uppercase
   * value it would fold onto — plus the rest of that table's uniqueness key, so
   * the operator can see the choice they are being asked to make without first
   * writing the grouping query themselves (review finding). A ready-to-paste
   * SELECT follows for the full rows.
   *
   * `table` and `keyRest` are interpolated from {@link SKIP_REPORTED_TABLES}, a
   * local literal list — no caller supplies either.
   */
  private async reportSkippedRows(
    queryRunner: QueryRunner,
    table: string,
    keyRest: readonly string[],
  ): Promise<void> {
    const keyRestSelect = keyRest.map((column) => `, "${column}"`).join('');
    const keyRestLabel =
      keyRest.length === 0 ? "''" : keyRest.map((column) => `"${column}"::text`).join(` || '/' || `);
    await queryRunner.query(`
      DO $$
      DECLARE
        skipped_count integer;
        skipped_pairs text;
      BEGIN
        SELECT count(*),
               string_agg(
                 DISTINCT format('%s -> %s%s',
                   "country",
                   UPPER("country"),
                   CASE WHEN ${keyRestLabel} = '' THEN '' ELSE ' [' || ${keyRestLabel} || ']' END),
                 ', ')
          INTO skipped_count, skipped_pairs
          FROM "${table}"
         WHERE "country" <> UPPER("country");

        IF skipped_count > 0 THEN
          RAISE NOTICE
            '#3176: left % row(s) in "${table}" with a non-uppercase country. Each pair below is the stray value and the uppercase value it would fold onto, with the rest of the uniqueness key in brackets: %. Inspect both sides with:  SELECT "country"${keyRestSelect} FROM "${table}" WHERE UPPER("country") IN (SELECT UPPER("country") FROM "${table}" WHERE "country" <> UPPER("country")) ORDER BY UPPER("country"), "country";  Then decide which row to keep, delete the other, and uppercase the survivor.',
            skipped_count, skipped_pairs;
        END IF;
      END
      $$;
    `);
  }
}

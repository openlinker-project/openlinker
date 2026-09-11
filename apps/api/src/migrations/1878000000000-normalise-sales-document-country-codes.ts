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
 * SAFE BY CONSTRUCTION, NOT BY ASSUMPTION: each `UPDATE` skips a row whose
 * uppercased country would COLLIDE with another row already occupying that
 * scope (`sales_document_country_acknowledgments`'s primary key is the
 * country itself; `sales_document_rules` is unique on
 * `(country, conditions_hash, effective_from)`; `sales_document_country_defaults`
 * is unique on `(country, document_kind)`). A colliding row is left in its
 * original case rather than merged or deleted — this migration has no way to
 * know which of two same-scope rows an operator would want to keep, and
 * guessing on a fiscal-routing rule is worse than leaving a known-stray row
 * for a human to resolve. No environment audited during this issue's design
 * carried such a collision (the observed duplicate market had zero rules and
 * zero defaults under either casing), so every `UPDATE` below is expected to
 * apply cleanly; the guard exists for an install this issue's author cannot
 * see.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormaliseSalesDocumentCountryCodes1878000000000 implements MigrationInterface {
  name = 'NormaliseSalesDocumentCountryCodes1878000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "sales_document_country_acknowledgments" a
      SET "country" = UPPER(a."country")
      WHERE a."country" <> UPPER(a."country")
        AND NOT EXISTS (
          SELECT 1 FROM "sales_document_country_acknowledgments" a2
          WHERE a2."country" = UPPER(a."country")
        )
    `);

    await queryRunner.query(`
      UPDATE "sales_document_country_defaults" d
      SET "country" = UPPER(d."country")
      WHERE d."country" <> UPPER(d."country")
        AND NOT EXISTS (
          SELECT 1 FROM "sales_document_country_defaults" d2
          WHERE d2."id" <> d."id"
            AND d2."country" = UPPER(d."country")
            AND d2."document_kind" = d."document_kind"
        )
    `);

    await queryRunner.query(`
      UPDATE "sales_document_rules" r
      SET "country" = UPPER(r."country")
      WHERE r."country" <> UPPER(r."country")
        AND NOT EXISTS (
          SELECT 1 FROM "sales_document_rules" r2
          WHERE r2."id" <> r."id"
            AND r2."country" = UPPER(r."country")
            AND r2."conditions_hash" = r."conditions_hash"
            AND r2."effective_from" = r."effective_from"
        )
    `);
  }

  public async down(): Promise<void> {
    // Intentionally a no-op, mirroring
    // `1840000000000-reset-fx-stamp-for-mislabelled-prestashop-orders.ts`.
    // Case-folding an ISO-3166-1 alpha-2 code loses no information there is
    // anything meaningful to restore, and no row is ever deleted or merged by
    // `up()` (a row that would collide is left untouched) — there is nothing
    // for `down()` to reverse.
  }
}

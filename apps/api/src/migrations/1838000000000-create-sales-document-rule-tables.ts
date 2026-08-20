/**
 * Create Sales-Document Rule Tables Migration (#2170, ADR-041 decision 5, narrowed)
 *
 * Three tables backing the country-agnostic sales-document rule engine:
 *
 *   - `sales_document_thresholds` — the versioned "regime pack" a rule's
 *     `orderTotalGross` condition references via `thresholdRef`, never an
 *     inline literal amount. Seeded here with the ONE Poland-specific row
 *     this issue ships (`pl-simplified-invoice-2026`) — deliberately as DATA
 *     in this `apps/api` migration, never as a literal string inside
 *     `libs/core/src/sales-documents/**` (the acceptance criterion this
 *     issue is explicit about).
 *   - `sales_document_rules` — one `conditions -> documentKind -> connection`
 *     mapping per row, scoped to a country (or `*`). `conditions_hash` is a
 *     plain stamped column (computed in application code, never a DB
 *     generated column — see the service's own doc comment), guarded by a
 *     plain unique index on the EXACT tuple `(country, conditions_hash,
 *     effective_from)`. That index catches an exact-duplicate insert only —
 *     the SEMANTIC "overlapping date range with a different connection"
 *     conflict guard is an application-level transaction, because Postgres
 *     cannot express "overlapping date range" in a plain unique index (and an
 *     `EXCLUDE USING gist` constraint would need the `btree_gist` extension
 *     for no benefit here, mirroring ADR-040's own "no database-level guard
 *     ships" trade-off for its append-only registry).
 *   - `sales_document_country_defaults` — tier 2 of the fallback ladder,
 *     unique on `(country, document_kind)` so "the default" is structurally
 *     singular.
 *
 * FK constraints to `connections` (ON DELETE CASCADE) mirror the
 * `fulfillment_routing_rules` precedent (#832) — deleting a connection also
 * removes any rule/default that pointed at it, rather than leaving an
 * orphaned reference the resolver would silently skip.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSalesDocumentRuleTables1838000000000 implements MigrationInterface {
  name = 'CreateSalesDocumentRuleTables1838000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sales_document_thresholds" (
        "ref" varchar(128) NOT NULL,
        "amount" numeric(18,2) NOT NULL,
        "currency" varchar(3) NOT NULL,
        "comparison_op" varchar(8) NOT NULL,
        "version_effective_from" date NOT NULL,
        "version_effective_to" date,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_document_thresholds" PRIMARY KEY ("ref")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sales_document_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country" varchar(8) NOT NULL,
        "conditions" jsonb NOT NULL,
        "conditions_hash" varchar(64) NOT NULL,
        "document_kind" varchar(64) NOT NULL,
        "connection_id" uuid NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "provenance" varchar(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_document_rules" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sales_document_rules_connection" FOREIGN KEY ("connection_id")
          REFERENCES "connections" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sales_document_rules_country_hash_from"
        ON "sales_document_rules" ("country", "conditions_hash", "effective_from")
    `);

    // No separate `(country, conditions_hash)` index (review, optional
    // improvements): its leading columns are already a strict prefix of the
    // unique index just above, which Postgres can use directly for a
    // `(country, conditions_hash)`-only lookup — a second index over the
    // same leading columns would only add write overhead with no query
    // benefit. `IDX_sales_document_rules_connection_id` below is NOT
    // redundant the same way: it covers a different column entirely (the FK
    // join target), which the unique index's leading columns do not prefix.

    await queryRunner.query(`
      CREATE INDEX "IDX_sales_document_rules_connection_id"
        ON "sales_document_rules" ("connection_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "sales_document_country_defaults" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country" varchar(8) NOT NULL,
        "document_kind" varchar(64) NOT NULL,
        "connection_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_sales_document_country_defaults" PRIMARY KEY ("id"),
        CONSTRAINT "FK_sales_document_country_defaults_connection" FOREIGN KEY ("connection_id")
          REFERENCES "connections" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_sales_document_country_defaults_country_kind"
        ON "sales_document_country_defaults" ("country", "document_kind")
    `);

    // Seed data (#2170) — the ONE Poland-specific value this issue ships,
    // deliberately here (a migration in `apps/api`) rather than as a literal
    // inside `libs/core/src/sales-documents/**`. Through 2026, a Polish
    // fiscal receipt carrying the buyer's tax id can stand in as a simplified
    // invoice up to 450 PLN (art. 106e ust. 5 pkt 3 of the PL VAT act, cited
    // and disclaimed in full at the "Review & adopt" starter-template screen
    // — this row is only the machine-readable amount, not the citation copy,
    // which lives in `apps/api/src/sales-documents/data/`). This is DATA, not
    // a legal-content string, so it does not trip the
    // no-country-specific-literal acceptance criterion, which is scoped to
    // `libs/core/src/sales-documents/**` source code.
    await queryRunner.query(`
      INSERT INTO "sales_document_thresholds"
        ("ref", "amount", "currency", "comparison_op", "version_effective_from", "version_effective_to")
      VALUES
        ('pl-simplified-invoice-2026', 450.00, 'PLN', 'lt', '2026-01-01', '2026-12-31')
      ON CONFLICT ("ref") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_sales_document_country_defaults_country_kind"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_country_defaults"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_sales_document_rules_connection_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_sales_document_rules_country_hash_from"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_rules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "sales_document_thresholds"`);
  }
}

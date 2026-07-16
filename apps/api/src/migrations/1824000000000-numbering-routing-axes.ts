/**
 * Numbering Routing Axes Migration (#1694)
 *
 * Extends the document-type routing model shipped in
 * `1821000000000-numbering-per-document-type-routing` with two additional
 * optional nullable axes on `invoice_numbering_routes`:
 *
 *  - `currency` (ISO-4217 invoice currency) — segments numbering per settlement
 *    currency.
 *  - `source` (the order's origin platformType, a neutral string) — segments
 *    numbering per sales channel.
 *
 * The routing key grows from `(connectionId, documentType, register)` to
 * `(connectionId, documentType, register, currency, source)`. Each axis is
 * nullable and a NULL is a WILDCARD; resolution is most-specific-match-wins
 * (see the repository).
 *
 * NULL-distinct uniqueness across THREE nullable axes would need 2^3 = 8 partial
 * indexes, so the two pre-#1694 partial unique indexes are replaced by a SINGLE
 * COALESCE-based unique index. `register` / `currency` / `source` never carry an
 * empty string (the request DTOs enforce `@IsNotEmpty`), so `COALESCE(col, '')`
 * is a safe NULL sentinel and collapses every NULL combination into one index. A
 * plain btree on `(connectionId, documentType)` backs the resolution lookups
 * (the COALESCE expression index does not serve equality on the raw columns).
 *
 * Idempotent (`IF [NOT] EXISTS`); `up()` + `down()`. Country-agnostic (ADR-026):
 * currency + source are neutral labels, no marketplace name is hardcoded.
 *
 * Generated: 2026-07-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NumberingRoutingAxes1824000000000 implements MigrationInterface {
  name = 'NumberingRoutingAxes1824000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Two new optional nullable axes (#1694). NULL = wildcard.
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_routes" ADD COLUMN IF NOT EXISTS "currency" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_routes" ADD COLUMN IF NOT EXISTS "source" text`,
    );

    // 2. Replace the two pre-#1694 partial unique indexes with a single
    //    COALESCE-based unique index over the full five-part routing key.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_numbering_routes_register"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_numbering_routes_default"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_numbering_routes_key"
        ON "invoice_numbering_routes" (
          "connectionId",
          "documentType",
          COALESCE("register", ''),
          COALESCE("currency", ''),
          COALESCE("source", '')
        )
    `);

    // 3. Plain btree to back the resolution equality lookups (the COALESCE
    //    expression index above does not serve equality on the raw columns).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IX_invoice_numbering_routes_lookup"
        ON "invoice_numbering_routes" ("connectionId", "documentType")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IX_invoice_numbering_routes_lookup"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_invoice_numbering_routes_key"`,
    );

    // Best-effort reconstruction of the pre-#1694 partial unique indexes. If rows
    // now differ only by currency/source (impossible before #1694), recreating
    // these could conflict; acceptable for a dev-only revert.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_numbering_routes_default"
        ON "invoice_numbering_routes" ("connectionId", "documentType")
        WHERE "register" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_numbering_routes_register"
        ON "invoice_numbering_routes" ("connectionId", "documentType", "register")
        WHERE "register" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_routes" DROP COLUMN IF EXISTS "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoice_numbering_routes" DROP COLUMN IF EXISTS "currency"`,
    );
  }
}

/**
 * Migration: Add order analytics read model
 *
 * #1985 — makes order data analytically queryable without JSON expansion.
 * Adds 4 denormalized scalar columns to `order_records` (`placedAt`,
 * `currency`, `taxTreatment`, `totalAmount`) and a new `order_line_items`
 * table, mirroring the existing `dispatchByAt`/`fulfillmentState` precedent.
 * See ADR-039 for the persistence-strategy decision.
 *
 * The backfill statements are idempotent by construction (`WHERE ... IS
 * NULL`, `ON CONFLICT ... DO NOTHING`), matching the house convention used by
 * `1818000000004-backfill-ksef-provider-invoice-number.ts` — re-running this
 * migration is a no-op on rows already backfilled.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderAnalyticsReadModel1839000000001 implements MigrationInterface {
  name = 'AddOrderAnalyticsReadModel1839000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Additive scalar columns on order_records.
    await queryRunner.query(`
      ALTER TABLE "order_records"
        ADD COLUMN IF NOT EXISTS "placedAt" timestamptz,
        ADD COLUMN IF NOT EXISTS "currency" varchar(3),
        ADD COLUMN IF NOT EXISTS "taxTreatment" varchar,
        ADD COLUMN IF NOT EXISTS "totalAmount" numeric(12,2)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_placedAt" ON "order_records" ("placedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_records_currency" ON "order_records" ("currency")`
    );

    // 2. New order_line_items table.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "order_line_items" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "orderRecordId" text NOT NULL,
        "lineNumber" int NOT NULL,
        "productId" text NOT NULL,
        "variantId" text,
        "quantity" int NOT NULL,
        "unitPrice" numeric(12,2) NOT NULL,
        "sourceConnectionId" uuid NOT NULL,
        "placedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_order_line_items" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_order_line_items_order_line" UNIQUE ("orderRecordId", "lineNumber")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_orderRecordId" ON "order_line_items" ("orderRecordId")`
    );
    // Composite, matching the #1987/#1988 access patterns rather than one
    // single-column index per column (review finding: five single-column
    // indexes on a table written on every order ingest is real write
    // amplification, and none of them served the actual queries well).
    // - (sourceConnectionId, placedAt): getUnitsSoldByConnection's optional
    //   per-connection filter + the mandatory placedAt range.
    // - (productId, placedAt): getProductChannelBreakdown's bounded
    //   productId IN (...) + the mandatory placedAt range.
    // variantId and a standalone placedAt index are deferred until a query
    // actually needs them.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_connection_placedAt" ON "order_line_items" ("sourceConnectionId", "placedAt")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_product_placedAt" ON "order_line_items" ("productId", "placedAt")`
    );

    // 3. Backfill existing order_records rows from the JSONB snapshot.
    // Guarded by "placedAt" IS NULL so re-running is a no-op — mirrors the
    // KSeF backfill precedent. `orderSnapshot ? 'placedAt'` further skips rows
    // whose source never exposed one (they stay NULL, as intended).
    await queryRunner.query(`
      UPDATE "order_records"
      SET
        "placedAt" = CASE
          WHEN "orderSnapshot" ? 'placedAt'
          THEN ("orderSnapshot"->>'placedAt')::timestamptz
        END,
        "currency" = "orderSnapshot"#>>'{totals,currency}',
        "taxTreatment" = "orderSnapshot"#>>'{totals,taxTreatment}',
        "totalAmount" = CASE
          WHEN jsonb_typeof("orderSnapshot"#>'{totals,total}') = 'number'
          THEN ("orderSnapshot"#>>'{totals,total}')::numeric
        END
      WHERE "placedAt" IS NULL AND "currency" IS NULL
    `);

    // 4. Backfill order_line_items for existing 'ready' records only — an
    // awaiting_mapping/source_deleted snapshot's items reference external,
    // not internal, ids (see OrderRecord's own doc comment) and must not be
    // written here. ON CONFLICT DO NOTHING makes re-running a no-op.
    //
    // The jsonb_typeof guards on quantity/price (#2014 review, SUGGESTION)
    // mirror step 3's totalAmount guard: quantity/unitPrice are NOT NULL on
    // order_line_items, so a legacy snapshot whose item is missing one or
    // holds a non-numeric value would otherwise abort the whole migration
    // with a cast error. The live path can't produce this (Order.items[]
    // types both as required) — this is historical-data risk only, and a
    // row that fails the guard is simply left un-backfilled rather than
    // failing the deploy.
    await queryRunner.query(`
      INSERT INTO "order_line_items"
        ("orderRecordId", "lineNumber", "productId", "variantId", "quantity", "unitPrice", "sourceConnectionId", "placedAt")
      SELECT
        rec."internalOrderId",
        (t.idx - 1)::int,
        t.item->>'productId',
        t.item->>'variantId',
        (t.item->>'quantity')::int,
        (t.item->>'price')::numeric,
        rec."sourceConnectionId",
        rec."placedAt"
      FROM "order_records" rec
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(rec."orderSnapshot"->'items') = 'array'
          THEN rec."orderSnapshot"->'items' ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS t(item, idx)
      WHERE rec."recordStatus" = 'ready'
        AND t.item->>'productId' IS NOT NULL
        AND jsonb_typeof(t.item->'quantity') = 'number'
        AND jsonb_typeof(t.item->'price') = 'number'
      ON CONFLICT ("orderRecordId", "lineNumber") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "order_line_items"`);
    await queryRunner.query(`
      ALTER TABLE "order_records"
        DROP COLUMN IF EXISTS "placedAt",
        DROP COLUMN IF EXISTS "currency",
        DROP COLUMN IF EXISTS "taxTreatment",
        DROP COLUMN IF EXISTS "totalAmount"
    `);
  }
}

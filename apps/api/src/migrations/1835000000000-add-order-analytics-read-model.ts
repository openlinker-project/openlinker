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

export class AddOrderAnalyticsReadModel1835000000000 implements MigrationInterface {
  name = 'AddOrderAnalyticsReadModel1835000000000';

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
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_productId" ON "order_line_items" ("productId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_variantId" ON "order_line_items" ("variantId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_sourceConnectionId" ON "order_line_items" ("sourceConnectionId")`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_placedAt" ON "order_line_items" ("placedAt")`
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

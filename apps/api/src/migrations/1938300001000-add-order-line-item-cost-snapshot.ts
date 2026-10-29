/**
 * Add Order Line Item Cost Snapshot
 *
 * Adds the per-line net unit cost snapshot to `order_line_items` (#3588, epic
 * #3516, D27): `unitCostNet` + `unitCostCurrency` and a `costState`
 * (`recorded` | `not-recorded`). Frozen at the first `ready` ingestion and
 * carried across re-ingestion by the write path, so a later edit of the variant
 * cost never moves an earlier margin. NULL cost = "not recorded", never zero.
 *
 * No backfill: every existing row defaults to `not-recorded`. The index serves
 * the per-variant margin read.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderLineItemCostSnapshot1938300001000 implements MigrationInterface {
  name = 'AddOrderLineItemCostSnapshot1938300001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order_line_items"
         ADD COLUMN IF NOT EXISTS "unitCostNet" numeric(12,4),
         ADD COLUMN IF NOT EXISTS "unitCostCurrency" varchar(3),
         ADD COLUMN IF NOT EXISTS "costState" varchar(16) NOT NULL DEFAULT 'not-recorded'`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items"
         ADD CONSTRAINT "CHK_order_line_items_cost_state"
         CHECK ("costState" IN ('recorded','not-recorded'))`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items"
         ADD CONSTRAINT "CHK_order_line_items_cost_state_matches_columns"
         CHECK (("costState" = 'recorded') = ("unitCostNet" IS NOT NULL AND "unitCostCurrency" IS NOT NULL))`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_order_line_items_variantId_placedAt"
         ON "order_line_items" ("variantId", "placedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_order_line_items_variantId_placedAt"`);
    await queryRunner.query(
      `ALTER TABLE "order_line_items" DROP CONSTRAINT IF EXISTS "CHK_order_line_items_cost_state_matches_columns"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items" DROP CONSTRAINT IF EXISTS "CHK_order_line_items_cost_state"`
    );
    await queryRunner.query(
      `ALTER TABLE "order_line_items"
         DROP COLUMN IF EXISTS "costState",
         DROP COLUMN IF EXISTS "unitCostCurrency",
         DROP COLUMN IF EXISTS "unitCostNet"`
    );
  }
}

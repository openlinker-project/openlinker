/**
 * Create Inventory Sale Decrements Migration (#3453)
 *
 * Creates `inventory_sale_decrements` — the durable, at-most-once record that
 * OpenLinker lowered (or deliberately did not lower) one routed work line's
 * stock in the product master that owns it.
 *
 * With the OMS on, a routed order is never created in the product master, so the
 * master's own order flow never lowers its stock. `InventorySaleDecrementService`
 * lowers it through `InventoryMasterPort.adjustInventory`, and this table is what
 * makes that write happen at most once: every writer goes through
 * `INSERT … ON CONFLICT ("idempotencyKey")`, and the claim is persisted BEFORE the
 * adapter call, so a crash between the write and the adapter's own remember step
 * leaves a `pending` row that the next run reports as `in_doubt` instead of
 * sending again. The adapter's own idempotency window is only a second layer —
 * WooCommerce and PrestaShop remember keys in a cache, and a host wired without
 * one reports `idempotency: 'unsupported'`.
 *
 * There is deliberately **no FK** to `order_records` or `fulfillment_works` —
 * the `order_cancellation_signals` / `refund_records` precedent of an indexed
 * reference by value: an audit record must outlive the rows it describes.
 * Nothing cascades into this table, so `apps/api/test/integration/setup.ts`
 * truncates it explicitly.
 *
 * Constraint and index names match `InventorySaleDecrementOrmEntity`'s
 * declarations exactly, because the integration harness builds its schema by
 * `synchronize` rather than by migration.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventorySaleDecrements1902000000000 implements MigrationInterface {
  name = 'CreateInventorySaleDecrements1902000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_sale_decrements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "idempotencyKey" character varying(255) NOT NULL,
        "orderId" text NOT NULL,
        "workId" text NOT NULL,
        "orderLineId" text NOT NULL,
        "productId" text NOT NULL,
        "productVariantId" text,
        "ownerConnectionId" text,
        "quantity" integer NOT NULL,
        "status" character varying(32) NOT NULL,
        "reason" character varying(64),
        "detail" text,
        "clamped" boolean NOT NULL DEFAULT false,
        "idempotencyUnsupported" boolean NOT NULL DEFAULT false,
        "resultingQuantity" integer,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_sale_decrements" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_inventory_sale_decrements_quantity_positive" CHECK ("quantity" > 0)
      )
    `);

    // THE enforcement. A replay, a re-poll and a job retry all derive the same
    // key, so the second writer conflicts instead of crossing the boundary.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inventory_sale_decrements_key"
        ON "inventory_sale_decrements" ("idempotencyKey")
    `);

    // The attention fold reads every row of one order.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_sale_decrements_order"
        ON "inventory_sale_decrements" ("orderId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_sale_decrements_order"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_inventory_sale_decrements_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_sale_decrements"`);
  }
}

/**
 * Create `inventory_movements` (#3565, epic #3512)
 *
 * The append-only stock movement ledger. No foreign keys (an audit record must
 * outlive what it names); every index is also declared on the ORM entity under
 * the same name because the integration harness builds schema by `synchronize`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateInventoryMovements1938200001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "inventory_movements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "productId" text NOT NULL,
        "productVariantId" text,
        "locationId" text,
        "sourceConnectionId" text,
        "reason" character varying(32) NOT NULL,
        "status" character varying(16) NOT NULL,
        "quantityDelta" integer NOT NULL,
        "quantityBefore" integer,
        "quantityAfter" integer,
        "sourceKind" character varying(16) NOT NULL,
        "sourceRef" text,
        "actorUserId" text,
        "operatorReason" character varying(32),
        "note" text,
        "idempotencyKey" text,
        "refusalReason" character varying(48),
        "refusalDetail" text,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_inventory_movements" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_movements_variant_occurred"
        ON "inventory_movements" ("productVariantId", "occurredAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_movements_product_occurred"
        ON "inventory_movements" ("productId", "occurredAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_movements_occurred"
        ON "inventory_movements" ("occurredAt")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_inventory_movements_idempotency_key"
        ON "inventory_movements" ("idempotencyKey")
        WHERE "idempotencyKey" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_inventory_movements_attention"
        ON "inventory_movements" ("occurredAt")
        WHERE "status" IN ('refused', 'in_doubt')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_movements_attention"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_inventory_movements_idempotency_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_movements_occurred"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_movements_product_occurred"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_inventory_movements_variant_occurred"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "inventory_movements"`);
  }
}

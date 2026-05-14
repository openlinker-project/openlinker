/**
 * Add Order Records Table Migration
 *
 * Creates table for order records (OrderRecord + SyncState) for retry/debug support
 * without re-polling source systems. Order snapshot is JSONB and PII-aware.
 *
 * Generated: 2026-01-11
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrderRecordsTable1770000000000 implements MigrationInterface {
  name = 'AddOrderRecordsTable1770000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Check if table already exists (might have been created manually or by a later migration)
    const table = await queryRunner.getTable('order_records');

    if (!table) {
      // Create order_records table
      await queryRunner.query(`
        CREATE TABLE "order_records" (
          "internalOrderId" text NOT NULL,
          "customerId" text,
          "sourceConnectionId" uuid NOT NULL,
          "sourceEventId" character varying,
          "orderSnapshot" jsonb NOT NULL,
          "syncStatus" jsonb NOT NULL DEFAULT '[]',
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_order_records" PRIMARY KEY ("internalOrderId")
        )
      `);

      // Create indexes for efficient lookups
      await queryRunner.query(`
        CREATE INDEX "IDX_order_records_customerId" ON "order_records" ("customerId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_order_records_sourceConnectionId" ON "order_records" ("sourceConnectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_order_records_createdAt" ON "order_records" ("createdAt")
      `);

      // Create GIN index on orderSnapshot for JSONB queries (optional, but useful for debugging)
      await queryRunner.query(`
        CREATE INDEX "IDX_order_records_orderSnapshot" ON "order_records" USING GIN ("orderSnapshot")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes first
    await queryRunner.query(`DROP INDEX "public"."IDX_order_records_orderSnapshot"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_records_createdAt"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_records_sourceConnectionId"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_order_records_customerId"`);

    // Drop table
    await queryRunner.query(`DROP TABLE "order_records"`);
  }
}

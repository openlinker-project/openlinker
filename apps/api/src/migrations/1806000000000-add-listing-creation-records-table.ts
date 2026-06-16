/**
 * Add Listing Creation Records Table Migration
 *
 * Creates the `listing_creation_records` table tracking OL-initiated product
 * publish attempts on shop destinations (OL → WooCommerce / Shopify, #1042,
 * ADR-024). The shop-side sibling of `offer_creation_records`; a separate table
 * keeps the hot marketplace offer path untouched. Lifecycle state
 * (pending / draft / published / failed) and structured errors are queryable
 * and indexed without polluting the generic identifier mapping table.
 *
 * Generated: 2026-06-15 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingCreationRecordsTable1806000000000 implements MigrationInterface {
  name = 'AddListingCreationRecordsTable1806000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const table = await queryRunner.getTable('listing_creation_records');

    if (!table) {
      await queryRunner.query(`
        CREATE TABLE "listing_creation_records" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "internalVariantId" text NOT NULL,
          "connectionId" uuid NOT NULL,
          "externalProductId" text,
          "status" text NOT NULL,
          "errors" jsonb,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_listing_creation_records" PRIMARY KEY ("id")
        )
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_listing_creation_records_variant_connection"
          ON "listing_creation_records" ("internalVariantId", "connectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_listing_creation_records_connectionId"
          ON "listing_creation_records" ("connectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_listing_creation_records_status"
          ON "listing_creation_records" ("status")
      `);

      // Partial composite index for `findByExternalProductIdAndConnectionId`.
      // `WHERE "externalProductId" IS NOT NULL` keeps pending rows (null external
      // id) out of the index. Name matches the ORM entity's explicit @Index.
      await queryRunner.query(`
        CREATE INDEX "IDX_listing_creation_records_external_product_connection"
          ON "listing_creation_records" ("externalProductId", "connectionId")
          WHERE "externalProductId" IS NOT NULL
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_listing_creation_records_external_product_connection"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_listing_creation_records_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_listing_creation_records_connectionId"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_listing_creation_records_variant_connection"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "listing_creation_records"`);
  }
}

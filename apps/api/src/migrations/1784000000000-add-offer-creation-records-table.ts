/**
 * Add Offer Creation Records Table Migration
 *
 * Creates the `offer_creation_records` table tracking OL-initiated offer creation
 * attempts on marketplaces (OL → Allegro / WooCommerce / eBay / etc.). Separate
 * from `identifier_mappings` (which tracks Offer ID linkage post-creation) so the
 * lifecycle state (pending / draft / validating / active / failed) and structured
 * validation errors can be queried and indexed without polluting the generic
 * identifier mapping table.
 *
 * Generated: 2026-04-20
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferCreationRecordsTable1784000000000 implements MigrationInterface {
  name = 'AddOfferCreationRecordsTable1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure uuid_generate_v4() is available. Defensive: existing tables also
    // rely on uuid-ossp but no prior migration creates it, so fresh databases
    // (CI, new environments) must have it provisioned before this DDL runs.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    const table = await queryRunner.getTable('offer_creation_records');

    if (!table) {
      await queryRunner.query(`
        CREATE TABLE "offer_creation_records" (
          "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
          "internalVariantId" text NOT NULL,
          "connectionId" uuid NOT NULL,
          "externalOfferId" text,
          "status" text NOT NULL,
          "errors" jsonb,
          "publishImmediately" boolean NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
          "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
          CONSTRAINT "PK_offer_creation_records" PRIMARY KEY ("id")
        )
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_offer_creation_records_variant_connection"
          ON "offer_creation_records" ("internalVariantId", "connectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_offer_creation_records_connectionId"
          ON "offer_creation_records" ("connectionId")
      `);

      await queryRunner.query(`
        CREATE INDEX "IDX_offer_creation_records_status"
          ON "offer_creation_records" ("status")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_offer_creation_records_status"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_creation_records_connectionId"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_offer_creation_records_variant_connection"`
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "offer_creation_records"`);
  }
}

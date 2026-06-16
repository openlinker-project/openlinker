/**
 * Add bulkBatchId to Listing Creation Records Migration
 *
 * Adds the nullable `bulkBatchId` column (+ index) to `listing_creation_records`
 * so a bulk shop-publish submission (#1044) can attach its child publish
 * attempts to a parent `bulk_listing_batches` row — reusing the same
 * child-type-agnostic batch + progress + advancement aggregate the marketplace
 * bulk-offer flow uses. Mirrors `offer_creation_records.bulkBatchId`. No FK is
 * enforced at the schema level (matches the `connectionId` precedent);
 * application code maintains referential integrity.
 *
 * Generated: 2026-06-16 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBulkBatchIdToListingCreationRecords1807000000000 implements MigrationInterface {
  name = 'AddBulkBatchIdToListingCreationRecords1807000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('listing_creation_records');
    if (!table) {
      return;
    }
    if (!table.findColumnByName('bulkBatchId')) {
      await queryRunner.query(
        `ALTER TABLE "listing_creation_records" ADD COLUMN "bulkBatchId" uuid`,
      );
      await queryRunner.query(`
        CREATE INDEX "IDX_listing_creation_records_bulkBatchId"
          ON "listing_creation_records" ("bulkBatchId")
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_listing_creation_records_bulkBatchId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "listing_creation_records" DROP COLUMN IF EXISTS "bulkBatchId"`,
    );
  }
}

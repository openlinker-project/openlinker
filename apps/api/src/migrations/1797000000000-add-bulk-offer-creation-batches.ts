/**
 * Add bulk_offer_creation_batches table + bulkBatchId on offer_creation_records (#734)
 *
 * Foundation slice for the bulk offer-creation epic (#726). Adds the parent
 * aggregate table and a nullable forward-compat reference from existing
 * offer-creation records so the bulk-submission service (#736) can write
 * the link without a separate schema PR.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBulkOfferCreationBatches1797000000000 implements MigrationInterface {
  name = 'AddBulkOfferCreationBatches1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "bulk_offer_creation_batches" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "connectionId"    uuid NOT NULL,
        "initiatedBy"     text NOT NULL,
        "status"          text NOT NULL,
        "totalCount"      integer NOT NULL,
        "succeededCount"  integer NOT NULL DEFAULT 0,
        "failedCount"     integer NOT NULL DEFAULT 0,
        "sharedConfig"    jsonb NOT NULL,
        "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"       TIMESTAMP NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_bulk_offer_creation_batches_connectionId" ON "bulk_offer_creation_batches" ("connectionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_bulk_offer_creation_batches_status" ON "bulk_offer_creation_batches" ("status")`,
    );
    await queryRunner.query(
      `ALTER TABLE "offer_creation_records" ADD COLUMN "bulkBatchId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_offer_creation_records_bulkBatchId" ON "offer_creation_records" ("bulkBatchId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The index on the surviving table (`offer_creation_records`) must be
    // dropped explicitly before the column is removed. Indexes on
    // `bulk_offer_creation_batches` are dropped implicitly by `DROP TABLE`.
    await queryRunner.query(`DROP INDEX "IDX_offer_creation_records_bulkBatchId"`);
    await queryRunner.query(`ALTER TABLE "offer_creation_records" DROP COLUMN "bulkBatchId"`);
    await queryRunner.query(`DROP TABLE "bulk_offer_creation_batches"`);
  }
}

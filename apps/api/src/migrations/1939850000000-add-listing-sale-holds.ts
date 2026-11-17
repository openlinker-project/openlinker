/**
 * Add listing_sale_holds (#3962)
 *
 * OpenLinker's record of each listing (marketplace offer or shop product) it
 * took off sale because the product or variant was deleted at the master:
 * how (stock 0, unpublished, or nothing possible), whether it worked, and
 * when an operator put it back on sale. At most one active hold per listing,
 * enforced by a partial unique index so the deletion trigger and the hourly
 * sweep cannot create two.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddListingSaleHolds1939850000000 implements MigrationInterface {
  name = 'AddListingSaleHolds1939850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "listing_sale_holds" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId" uuid NOT NULL,
        "entityType" text NOT NULL,
        "externalId" text NOT NULL,
        "externalParentId" text,
        "internalProductId" text NOT NULL,
        "internalVariantId" text,
        "method" text NOT NULL,
        "outcome" text NOT NULL,
        "outcomeReason" text,
        "staleAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "appliedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "releasedAt" TIMESTAMP WITH TIME ZONE,
        "releasedBy" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_listing_sale_holds" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_listing_sale_holds_active_listing"
        ON "listing_sale_holds" ("connectionId", "entityType", "externalId")
        WHERE "releasedAt" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_listing_sale_holds_product"
        ON "listing_sale_holds" ("internalProductId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "listing_sale_holds"`);
  }
}

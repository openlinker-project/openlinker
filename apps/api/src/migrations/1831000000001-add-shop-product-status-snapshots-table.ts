/**
 * Add shop_product_status_snapshots table (#1845)
 *
 * Persists the periodically-refreshed shop-side publication status of products
 * OL published to a shop connection (the steady-state `shop.product.statusSync`
 * job). The shop-side sibling of `offer_status_snapshots`: long-lived and
 * re-read on a schedule so operators can see when a product is unpublished /
 * trashed shop-side without opening each storefront listing.
 *
 * Schema mirrors `offer_status_snapshots` (uuid PK default, uuid connectionId,
 * text external/variant ids + status, jsonb detail, timestamptz sync stamp).
 * No FK constraints (matches the recent snapshot/record table convention).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopProductStatusSnapshotsTable1831000000001 implements MigrationInterface {
  name = 'AddShopProductStatusSnapshotsTable1831000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "shop_product_status_snapshots" (
        "id"                  uuid NOT NULL DEFAULT uuid_generate_v4(),
        "connectionId"        uuid NOT NULL,
        "externalProductId"   text NOT NULL,
        "internalVariantId"   text NOT NULL,
        "publicationStatus"   text NOT NULL,
        "statusDetails"       jsonb,
        "lastStatusSyncedAt"  TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt"           TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt"           TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_shop_product_status_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_shop_product_status_snapshots_product_connection" ON "shop_product_status_snapshots" ("externalProductId", "connectionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shop_product_status_snapshots_variant" ON "shop_product_status_snapshots" ("internalVariantId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shop_product_status_snapshots_lastSyncedAt" ON "shop_product_status_snapshots" ("lastStatusSyncedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_shop_product_status_snapshots_connection_status" ON "shop_product_status_snapshots" ("connectionId", "publicationStatus")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_shop_product_status_snapshots_connection_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_shop_product_status_snapshots_lastSyncedAt"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_shop_product_status_snapshots_variant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_shop_product_status_snapshots_product_connection"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "shop_product_status_snapshots"`);
  }
}

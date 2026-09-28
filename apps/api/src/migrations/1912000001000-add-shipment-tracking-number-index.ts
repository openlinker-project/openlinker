/**
 * Add a partial index on `shipments.trackingNumber` (#3528)
 *
 * Backs the `/orders` search bar's exact-match "find by waybill number" path
 * (`ShipmentFilters.trackingNumber`, `IShipmentQueryService.list`). Partial —
 * `WHERE "trackingNumber" IS NOT NULL` — because the overwhelming majority of
 * rows carry no tracking number yet (a label not yet generated) and a full
 * index over them would index nothing an equality lookup ever asks for.
 *
 * Hand-authored to keep it partial, which `migration:generate` does not emit.
 *
 * Timestamp is this epic's synthetic block (#3507): 1912000000000 -
 * 1912999999999, one step after `1912000000000-add-order-record-search-text.ts`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentTrackingNumberIndex1912000001000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX "IDX_shipments_trackingNumber"
        ON "shipments" ("trackingNumber")
        WHERE "trackingNumber" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_shipments_trackingNumber"`);
  }
}

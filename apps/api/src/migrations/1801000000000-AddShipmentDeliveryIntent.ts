/**
 * Add Shipment Delivery Intent (#979, ADR-020)
 *
 * Adds the nullable `deliveryIntent` column — the carrier-neutral intent a
 * dispatch was requested with. Nullable because branch-1/omp projection rows
 * (#834) carry no intent. Backfills label rows from the persisted carrier
 * method so existing shipments read consistently; `omp` rows stay NULL.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentDeliveryIntent1801000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" ADD "deliveryIntent" text`);
    await queryRunner.query(`
      UPDATE "shipments"
      SET "deliveryIntent" = CASE
        WHEN "shippingMethod" IN ('paczkomat', 'pickup') THEN 'pickup_point'
        WHEN "shippingMethod" = 'kurier' THEN 'address'
        ELSE NULL
      END
      WHERE "deliveryIntent" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN "deliveryIntent"`);
  }
}

/**
 * Add Shipment Provider Code
 *
 * Adds the nullable `providerCode` column to `shipments` (#1918) — the
 * structured `ShippingProviderRejectionException.providerCode` discriminator
 * (e.g. `preflight.missing-parcel-template`, `api.http-503`, or a carrier-
 * surfaced code) alongside the existing free-text `errorMessage`. Additive,
 * nullable, no backfill required.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentProviderCode1832000000000 implements MigrationInterface {
  name = 'AddShipmentProviderCode1832000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "providerCode" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "providerCode"`);
  }
}

/**
 * Add shipments.sourceDeliveryMethodId (#833)
 *
 * Persists the source-side delivery-method id (`OrderShipping.methodId`) the
 * shipment was routed from, for audit/forensics — distinct from the resolved
 * provider delivery-method id the adapter sends. Decided in #833's `/grill-me`
 * pass (A2): the `Shipment` aggregate is a self-describing record of the
 * external commitment (it already persists `paczkomatId` / `shippingMethod`),
 * so the source method it routed from belongs on the row too.
 *
 * Additive + nullable → backward-compatible: existing rows get NULL, and the
 * column is never patched (set once at create-time). `down()` drops it.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentSourceDeliveryMethod1799000000006 implements MigrationInterface {
  name = 'AddShipmentSourceDeliveryMethod1799000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" ADD "sourceDeliveryMethodId" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN "sourceDeliveryMethodId"`);
  }
}

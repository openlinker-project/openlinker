/**
 * Add Shipment waybillRelayedAt Migration
 *
 * Adds `waybillRelayedAt` (nullable timestamp) to `shipments` (#1947). It marks
 * when the shipment's waybill was successfully relayed to the order's SOURCE
 * participant, and is claimed conditionally (`WHERE "waybillRelayedAt" IS NULL`)
 * so the status-sync poll and the carrier webhook — which both observe the same
 * `trackingNumber` null→value transition, unserialized — cannot both relay.
 *
 * Why a column and not an inference from `trackingNumber`: that field is the
 * data, and it was doing double duty as the retry marker for every participant,
 * which made "known to OL" and "delivered to the source" indistinguishable.
 *
 * Nullable/additive — every existing row starts unclaimed, which is correct:
 * none of them has told a source about a late-arriving waybill (that path did
 * not exist before #1947). A backfill would be wrong, since it would suppress
 * the first legitimate relay for shipments still in flight.
 *
 * Prefix follows the synthetic sequential convention in docs/migrations.md
 * (#1013): sorts strictly after this branch's `main` tail `1832000000006`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentWaybillRelayedAt1832000000007 implements MigrationInterface {
  name = 'AddShipmentWaybillRelayedAt1832000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "waybillRelayedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "waybillRelayedAt"`);
  }
}

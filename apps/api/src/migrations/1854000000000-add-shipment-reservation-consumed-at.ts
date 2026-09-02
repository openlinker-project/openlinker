/**
 * Add `shipments.reservationConsumedAt` — the reservation-consume claim marker (#2347)
 *
 * The persistence half of the consume pass: a nullable timestamp claimed
 * conditionally (`WHERE "reservationConsumedAt" IS NULL`) so that "this order's
 * held reservations have been consumed" is a database fact rather than a
 * convention. See `Shipment.reservationConsumedAt` for why it is a dedicated
 * column and not inferred from `status`.
 *
 * The partial index serves the sweep's candidate read. Its predicate references
 * ONLY the marker — deliberately not `status`, which is mutable over a
 * shipment's life and would make rows enter and leave the index on ordinary
 * updates.
 *
 * Both statements are `IF [NOT] EXISTS`-guarded so a re-run is a no-op, and
 * both mirror `shipment.orm-entity.ts` exactly (column type + nullability,
 * index name + predicate) — the integration harness builds its schema with
 * `synchronize`, so any drift between the two surfaces only there.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentReservationConsumedAt1854000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "reservationConsumedAt" TIMESTAMP`
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_shipments_reservation_consume_pending" ` +
        `ON "shipments" ("createdAt") WHERE "reservationConsumedAt" IS NULL`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_shipments_reservation_consume_pending"`);
    await queryRunner.query(
      `ALTER TABLE "shipments" DROP COLUMN IF EXISTS "reservationConsumedAt"`
    );
  }
}

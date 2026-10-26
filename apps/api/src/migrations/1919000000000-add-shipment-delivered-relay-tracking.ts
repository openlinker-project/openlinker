import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retryable `delivered` lifecycle relay on `shipments` (#3506, G02-7).
 *
 * The delivered relay used to be one-shot: it fired only on the poll that
 * discovered the carrier's `delivered` transition, a participant rejection was
 * logged and dropped, and the row then left the status scan for good. These
 * three columns let `ShipmentStatusSyncService` know which delivered shipments
 * still owe the relay and re-drive them on later ticks, bounded by a failure
 * count:
 *
 * - `deliveredRelayedAt` - when the relay reached every participant that could
 *   take it; NULL on a delivered row means it is still owed.
 * - `deliveredRelayFailureCount` - failed attempts, `DEFAULT 0` kept (0 is the
 *   true and permanent meaning for every row, as with `waybillRelayFailureCount`).
 * - `deliveredRelayLastFailureAt` - the retry back-off anchor.
 *
 * Every column, the CHECK and the partial index mirror their declarations on
 * `ShipmentOrmEntity` under the same names, because the integration harness
 * builds schema by `synchronize` and never runs migrations.
 *
 * `TIMESTAMP` without time zone, NOT `timestamptz`: every timestamp on
 * `shipments` (including the two claim markers and the waybill-relay failure
 * columns, migration `1876000000000`) is plain `TIMESTAMP`, and the rule
 * followed for this table is consistency within it.
 *
 * BACKFILL: every shipment already `delivered` is stamped as relayed
 * (`COALESCE("deliveredAt", now())`). Those rows went through the old one-shot
 * relay, successfully or not, and there is no record of which; re-driving all
 * of history on the first tick after deploy would send a burst of `delivered`
 * writes for parcels that arrived months ago. A shipment whose old one-shot
 * relay was rejected therefore stays as it is, which is the pre-migration
 * state - the retry covers deliveries from this migration on.
 *
 * The partial index serves the re-drive pass's candidate predicate. `status =
 * 'delivered'` is terminal, so a row enters the index once (delivered while
 * still owed) and leaves it once (stamped); the relay that discovers the
 * transition stamps BEFORE the status write lands, so a relay that succeeds
 * first time never enters it. Near-empty in steady state.
 */
export class AddShipmentDeliveredRelayTracking1919000000000 implements MigrationInterface {
  name = 'AddShipmentDeliveredRelayTracking1919000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN IF NOT EXISTS "deliveredRelayedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "deliveredRelayFailureCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "deliveredRelayLastFailureAt" TIMESTAMP
    `);

    // Idempotent: `ADD CONSTRAINT` has no `IF NOT EXISTS` form in Postgres.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_shipments_delivered_relay_failure_count'
        ) THEN
          ALTER TABLE "shipments"
            ADD CONSTRAINT "CHK_shipments_delivered_relay_failure_count"
            CHECK ("deliveredRelayFailureCount" >= 0);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      UPDATE "shipments"
         SET "deliveredRelayedAt" = COALESCE("deliveredAt", now())
       WHERE "status" = 'delivered'
         AND "deliveredRelayedAt" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shipments_delivered_relay_pending"
        ON "shipments" ("connectionId", "createdAt")
        WHERE "status" = 'delivered' AND "deliveredRelayedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_shipments_delivered_relay_pending"`
    );
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP CONSTRAINT IF EXISTS "CHK_shipments_delivered_relay_failure_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP COLUMN IF EXISTS "deliveredRelayLastFailureAt",
        DROP COLUMN IF EXISTS "deliveredRelayFailureCount",
        DROP COLUMN IF EXISTS "deliveredRelayedAt"
    `);
  }
}

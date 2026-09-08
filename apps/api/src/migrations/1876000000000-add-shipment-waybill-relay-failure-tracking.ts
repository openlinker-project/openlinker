import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Waybill-relay failure tracking on `shipments` (#2073).
 *
 * Five columns, one CHECK and one partial index so that a lifecycle relay
 * failing on every poll tick becomes a durable, operator-visible fact instead
 * of one `logger.error` per tick against a job that still reports `succeeded`.
 *
 * Every column mirrors its `@Column` declaration on `ShipmentOrmEntity` exactly,
 * and the CHECK and the index are declared there under these same names. That
 * duplication is required rather than redundant: the integration harness builds
 * schema by TypeORM `synchronize` and never runs migrations, so a constraint
 * living only here would hold in production and silently not in tests.
 *
 * `TIMESTAMP` without time zone, matching `waybillRelayedAt` (migration
 * `1832000000007`) and `reservationConsumedAt` on the same table. The repo is
 * mixed on this, so the rule followed is consistency WITHIN the table — copying
 * `webhook_auth_rejections`' `timestamptz` would have diverged the two schema
 * sources for `shipments`.
 *
 * `waybillRelayFailureCount` keeps its `DEFAULT 0` rather than dropping it after
 * backfill (the way `direction` drops its default in `1862000000000`), and the
 * asymmetry is deliberate: `'outbound'` was a backfill guess that must not
 * become an implicit answer for future inserts, whereas `0` is the true and
 * permanent meaning of "this shipment has had no relay failure". Every existing
 * row genuinely has none, and every future insert wants it.
 */
export class AddShipmentWaybillRelayFailureTracking1876000000000 implements MigrationInterface {
  name = 'AddShipmentWaybillRelayFailureTracking1876000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "shipments"
        ADD COLUMN IF NOT EXISTS "waybillRelayFailureCount" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "waybillRelayFirstFailedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "waybillRelayLastFailedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "waybillRelayLastFailureReason" text,
        ADD COLUMN IF NOT EXISTS "waybillRelayLastFailureConnectionId" uuid
    `);

    // Idempotent: `ADD CONSTRAINT` has no `IF NOT EXISTS` form in Postgres, so
    // guard on the catalogue. The counter can only ever be incremented from 0
    // or reset to 0 by this codebase — the constraint documents that the column
    // is a counter and catches a future writer that decrements.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CHK_shipments_waybill_relay_failure_count'
        ) THEN
          ALTER TABLE "shipments"
            ADD CONSTRAINT "CHK_shipments_waybill_relay_failure_count"
            CHECK ("waybillRelayFailureCount" >= 0);
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_shipments_waybill_relay_failing"
        ON "shipments" ("waybillRelayLastFailedAt")
        WHERE "waybillRelayFailureCount" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_shipments_waybill_relay_failing"`);
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP CONSTRAINT IF EXISTS "CHK_shipments_waybill_relay_failure_count"
    `);
    await queryRunner.query(`
      ALTER TABLE "shipments"
        DROP COLUMN IF EXISTS "waybillRelayLastFailureConnectionId",
        DROP COLUMN IF EXISTS "waybillRelayLastFailureReason",
        DROP COLUMN IF EXISTS "waybillRelayLastFailedAt",
        DROP COLUMN IF EXISTS "waybillRelayFirstFailedAt",
        DROP COLUMN IF EXISTS "waybillRelayFailureCount"
    `);
  }
}

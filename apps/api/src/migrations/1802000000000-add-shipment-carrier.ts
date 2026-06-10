/**
 * Add Shipment Carrier (re-timestamped)
 *
 * Adds the `carrier` column + `IDX_shipments_carrier` index to `shipments` —
 * the actual carrier-of-record (#769), distinct from the dispatcher.
 *
 * Retimestamped from `1779985594755` → `1802000000000` (#1013): the original
 * file (PR #881) kept the real epoch timestamp emitted by `migration:generate`
 * instead of the synthetic sequential convention, so it sorted *before*
 * `AddShipmentsTable1799000000000` and fresh-DB `migration:run` failed with
 * `relation "shipments" does not exist`. The `up()` body self-heals across
 * both affected states (same pattern as `AddCurrencyToProducts1790000000002`,
 * the #374 recovery):
 *
 *   1. DELETE the `migrations` row written under the old class name on
 *      incremental DBs where the original ran successfully (no-op on fresh
 *      DBs — a failed original run left no row, TypeORM rolls the row back
 *      with the migration transaction).
 *   2. `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so
 *      re-applying after a successful original run is a no-op rather than a
 *      `column "carrier" already exists` failure.
 *
 * All statements commit atomically with TypeORM's insert into `migrations`
 * (migrations run under `transaction: 'all'` and Postgres supports DDL inside
 * transactions), so every environment converges to one consistent end state.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShipmentCarrier1802000000000 implements MigrationInterface {
  name = 'AddShipmentCarrier1802000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "migrations" WHERE "name" = 'AddShipmentCarrier1779985594755'`
    );
    await queryRunner.query(`ALTER TABLE "shipments" ADD COLUMN IF NOT EXISTS "carrier" text`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_shipments_carrier" ON "shipments" ("carrier")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."IDX_shipments_carrier"`);
    await queryRunner.query(`ALTER TABLE "shipments" DROP COLUMN IF EXISTS "carrier"`);
  }
}

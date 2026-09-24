/**
 * Add `users."pack_station_label"/"last_active_at"` +
 * `fulfillment_works."unassignedSince"` (#3424, mockup-parity epic #3401)
 *
 * ## `users."pack_station_label"`
 *
 * A packer's own free-text label for their bench/printer, e.g.
 * "Bench 3 / Zebra ZD420". Deliberately CONFIG, not identity — ADR-071
 * rejects a station/device *principal* ("no station token, no PIN, no
 * badge"), so this column carries no authentication weight; it is read and
 * displayed exactly like a connection's operator-authored `name`.
 *
 * ## `users."last_active_at"`
 *
 * Best-effort online-presence heartbeat for the Assign Packing Work board
 * (#3427), bumped by bench activity — never a login/session event, so a
 * signed-in-but-idle packer reads as offline once the presence window
 * elapses. `snake_case` name, matching this table's existing column-naming
 * convention (`created_at`, `updated_at`, `analytics_consent`).
 *
 * ## `fulfillment_works."unassignedSince"`
 *
 * When a work object last became unassigned — feeds the operator board's
 * "oldest unassigned" metric (#3428). `camelCase` name, matching THIS
 * table's own convention (every other column on `fulfillment_works` is
 * camelCase; the two tables simply disagree with each other, and each
 * migration follows the table it is extending rather than imposing a
 * cross-table standard this migration has no mandate to set).
 *
 * All three columns are nullable with no default: `null` is correct for
 * every pre-existing row (never observed, never unassigned-since-tracking
 * existed) and needs no backfill.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackStationPresenceAndUnassignedSince1896000000000
  implements MigrationInterface
{
  name = 'AddPackStationPresenceAndUnassignedSince1896000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pack_station_label" VARCHAR`
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "last_active_at" TIMESTAMPTZ`
    );
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" ADD COLUMN IF NOT EXISTS "unassignedSince" TIMESTAMPTZ`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "fulfillment_works" DROP COLUMN IF EXISTS "unassignedSince"`
    );
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "last_active_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pack_station_label"`);
  }
}

/**
 * Add `users."display_name"` + `users."must_change_password"` (#3456, epic #3460)
 *
 * ## `users."display_name"`
 *
 * The person's name as an admin typed it when creating the account, e.g.
 * "Anna Kowalska" (the OMS onboarding wizard's "Add packers" step). Until now
 * the only human-readable identity on a user was the login (`username`), which
 * is what every list rendered. Nullable with no default: every pre-existing
 * account has no display name, and surfaces fall back to `username`.
 *
 * ## `users."must_change_password"`
 *
 * Set when an admin creates the account with a one-time password (`POST
 * /users`); cleared by the user's own password change, in the SAME statement
 * that writes the new hash. While set, `PasswordChangeRequiredGuard` refuses
 * every authenticated route except reading the session and changing the
 * password. `NOT NULL DEFAULT false`, so every existing account reads `false`
 * and nobody is locked out on deploy.
 *
 * `snake_case`, matching this table's convention (`pack_station_label`,
 * `last_active_at`, `analytics_consent`).
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDisplayNameAndMustChangePassword1906000000000 implements MigrationInterface {
  name = 'AddUserDisplayNameAndMustChangePassword1906000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "display_name" VARCHAR`);
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "display_name"`);
  }
}

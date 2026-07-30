/**
 * Add User analyticsConsent Migration
 *
 * Adds `analytics_consent` (boolean) to `users` (#1743). Captures, at
 * registration time, the account's consent to demo session recording
 * (PostHog) — replacing the old post-login banner prompt.
 *
 * Defaults `false`, so every pre-existing row backfills to "not consented":
 * no account has recording enabled without an active choice. #1938 later made
 * that consent a condition of using the demo (required to register; an older
 * account without it is sent to `/consent` to agree or sign out) — deliberately
 * NOT a data backfill, so the flag still only ever flips on a real choice.
 *
 * Column name is snake_case (`analytics_consent`) to match the users table's
 * existing explicit-name columns (`password_hash`, `created_at`); the ORM
 * entity carries the `name` mapping.
 *
 * Generated: 2026-07-21 (synthetic sequential prefix per docs/migrations.md
 * #1013 — sorts strictly after the current `main` tail `1826000000000`).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAnalyticsConsent1827000000000 implements MigrationInterface {
  name = 'AddUserAnalyticsConsent1827000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analytics_consent" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "analytics_consent"`,
    );
  }
}

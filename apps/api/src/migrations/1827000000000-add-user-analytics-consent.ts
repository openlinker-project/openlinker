/**
 * Add User analyticsConsent Migration
 *
 * Adds `analytics_consent` (boolean) to `users` (#1743). Captures, at
 * registration time, the account's opt-in for demo-only usage analytics
 * (PostHog session recording) — replacing the old post-login banner prompt.
 * Defaults `true` (default-on): the registration checkbox ships pre-checked,
 * and every pre-existing row backfills to "consented" so the change is
 * behaviour-preserving for accounts created before this column existed.
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
      `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analytics_consent" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN IF EXISTS "analytics_consent"`,
    );
  }
}

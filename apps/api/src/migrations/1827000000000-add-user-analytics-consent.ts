/**
 * Add User analyticsConsent Migration
 *
 * Adds `analytics_consent` (boolean) to `users` (#1743). Captures, at
 * registration time, whether demo session recording (PostHog) applies to the
 * account — replacing the old post-login banner prompt.
 *
 * WHAT THE COLUMN MEANS CHANGED IN #1938 — read this before reasoning about it.
 *
 * As shipped in #1743 it recorded **consent**: analytics was optional, and the
 * legal basis was consent under GDPR Art. 6(1)(a), which is why the box shipped
 * unchecked (a pre-ticked box is not valid consent — CJEU Planet49, C-673/17)
 * and why Settings offered a withdrawal toggle (Art. 7(3)).
 *
 * #1938 made recording a **condition of using the free demo** instead, and the
 * column now records **acceptance of that condition**, not consent: the
 * registration form discloses recording and creating the account accepts it,
 * `/consent` collects the same acceptance from accounts created earlier, and the
 * demo is refused without it. Planet49's pre-ticked-box holding is therefore no
 * longer the operative test — there is no consent construct left to weaken, and
 * correspondingly no in-product withdrawal (declining means not using the demo,
 * which carries no detriment: the demo is free, optional, and runs only on
 * synthetic data). The alternative — keeping the consent basis, an unticked box,
 * and a withdrawal path — was considered and rejected in review on #1945,
 * because a consent that cannot be declined without losing access is not freely
 * given, and dressing the condition as a choice is what created the exposure.
 *
 * What the framing settles and what it does not: it fixes the GDPR Art. 6 basis
 * and removes the Art. 7(3) withdrawal obligation. It does NOT settle ePrivacy
 * Art. 5(3), which governs storage of / access to information on the visitor's
 * device independently of the Art. 6 basis and carries its own narrower
 * exemptions. That is a privacy-notice sign-off question rather than a code one
 * (the enforcement mechanism is the same either way) — recorded, with the shape
 * it would force if the answer goes the other way, in
 * docs/plans/implementation-plan-demo-consent-required.md § 0.
 *
 * Two things deliberately did NOT change: the default stays `false`, so every
 * pre-existing row reads as "not accepted", and #1938 ships **no data
 * backfill** — the flag still only ever flips when someone actually accepts.
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

/**
 * Add `analytics_display_settings` (#2461, epic #2452 Phase 3)
 *
 * A singleton-row table (`id = 'singleton'`) holding three operator
 * preferences consumed by the `/analytics` dashboard: a display-currency
 * override, the rate-recomputation basis, and the backfilled-tax-rate Net
 * Sales inclusion opt-in from ADR-063's amendment for #2456. None of the
 * three is the reporting currency itself and none mutates any
 * `order_records` row — see `docs/architecture-overview.md § Analytics`.
 *
 * Column shape follows the sibling `posthog_settings` table verbatim (same
 * context, same singleton pattern): snake_case columns via explicit
 * naming, an `updated_at` default of `now()`, a nullable `updated_by_*`
 * audit column. Hand-authored rather than taken verbatim from
 * `migration:generate` — the generated diff against a locally-migrated dev
 * DB also carried a large amount of unrelated FK-constraint churn from
 * column-order drift accumulated across prior migrations, matching the
 * documented false-positive shape in `docs/migrations.md`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsDisplaySettings1870000005000 implements MigrationInterface {
  name = 'AddAnalyticsDisplaySettings1870000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analytics_display_settings" (
        "id" text NOT NULL,
        "display_currency" character varying(3),
        "rate_basis" text NOT NULL DEFAULT 'current',
        "include_backfilled_tax_rates_in_net_sales" boolean NOT NULL DEFAULT false,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by_user_id" text,
        CONSTRAINT "PK_analytics_display_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "analytics_display_settings"`);
  }
}

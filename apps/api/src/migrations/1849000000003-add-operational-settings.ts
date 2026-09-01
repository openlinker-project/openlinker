/**
 * Add the `operational_settings` singleton row (#2651)
 *
 * The operator-settable sweep budgets and deletion-audit cadence. Singleton
 * row keyed `id = 'singleton'`, matching
 * `1792000000000-add-ai-provider-active-setting.ts` and
 * `1825000000000-add-posthog-settings.ts`; snake_case columns, matching the
 * rest of that settings family (the ORM entity carries explicit `name:`).
 *
 * EVERY VALUE COLUMN IS NULLABLE AND NO ROW IS SEEDED. `NULL` means "not set -
 * fall through to the env var, then to the code default", so an install that
 * upgrades past this migration and never opens the settings page behaves
 * byte-identically to how it behaved before it.
 *
 * Hand-authored rather than generated: `migration:generate` would re-emit the
 * `timestamptz` column as `timestamp without time zone`.
 *
 * Timestamp is a synthetic sequential prefix per `docs/migrations.md`
 * § Timestamp uniqueness invariant - the tail on this branch is
 * `1849000000002` (`add-sync-job-deferred-total`) and on `origin/main`
 * `1841000000006`, so `1849000000003` is strictly greater than both. The
 * `1842`-`1848` band is claimed by open PR #2441 and `1841000000007` by open
 * PR #2630; neither is on `main`, so the invariant script cannot see them.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOperationalSettings1849000000003 implements MigrationInterface {
  name = 'AddOperationalSettings1849000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "operational_settings" (
        "id" text NOT NULL,
        "catalogue_sweep_budget" integer,
        "inventory_sweep_budget" integer,
        "sweep_page_size" integer,
        "deletion_audit_budget" integer,
        "deletion_audit_cadence" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_operational_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "operational_settings"`);
  }
}

/**
 * Add `analytics_remediation_runs` (#2468, epic #2452 Phase 5)
 *
 * The audit ledger for Data Coverage remediations — one row per operator
 * request, recording who asked, over how many orders, and how it ended. Shape
 * pinned by the Phase 1 Task 1.2 decision doc
 * (`docs/plans/analytics-coverage-remediation-decision.md` § Decision 2), with
 * two properties from that doc carried verbatim rather than reinterpreted.
 *
 * `category` STAYS AN OPEN `text` COLUMN, with no CHECK constraint. A future
 * genuinely-async category must be able to reuse this table without a
 * migration — but in this epic only the `'currency'` category ever writes a
 * row. The tax side turned out to be a query-time settings toggle (ADR-063's
 * amendment for #2456), so it has no run, no lifecycle and nothing to poll;
 * constraining the column to today's single value would have to be reversed the
 * first time that changes.
 *
 * THE PARTIAL UNIQUE INDEX IS THE CONCURRENCY CONTROL, not a nicety. It admits
 * at most one `open`/`in-progress` run per category, which is what makes a
 * double-click on "Recalculate all N now" a 409 rather than two overlapping
 * repairs — two runs would clear and re-enqueue the same orders under two run
 * ids, and the second's completion poll could resolve while the first still had
 * work in flight. It is partial because terminal rows must accumulate freely:
 * the history is the audit trail. The repository relies on the index rather than
 * a preceding read, so two concurrent requests cannot both observe "no open
 * run".
 *
 * `status` is likewise plain `text` rather than a CHECK over
 * `CoverageResolutionStatus`: the union lives in `libs/core` and the repository's
 * `toDomain` already refuses a value this build cannot represent, loudly. A
 * duplicated CHECK here would be a second place to edit whenever the union
 * moves, with no additional guarantee.
 *
 * Hand-authored rather than taken from `migration:generate`, for the reason the
 * sibling `1842000000000-add-analytics-display-settings` migration documents:
 * the generated diff against a locally-migrated dev DB also carries unrelated
 * FK-constraint churn from accumulated column-order drift, the documented
 * false-positive shape in `docs/migrations.md`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsRemediationRuns1843000000000 implements MigrationInterface {
  name = 'AddAnalyticsRemediationRuns1843000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "analytics_remediation_runs" (
        "id" text NOT NULL,
        "category" text NOT NULL,
        "status" text NOT NULL,
        "detail" text,
        "affected_count" integer NOT NULL,
        "triggered_by" text NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_remediation_runs" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_analytics_remediation_runs_open_per_category"
        ON "analytics_remediation_runs" ("category")
        WHERE "status" IN ('open', 'in-progress')
    `);

    // Supports the newest-first per-category history read the run service uses
    // for `findOpenByCategory`'s ordering and any future audit listing.
    await queryRunner.query(`
      CREATE INDEX "IDX_analytics_remediation_runs_category_created"
        ON "analytics_remediation_runs" ("category", "created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_analytics_remediation_runs_category_created"`
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_analytics_remediation_runs_open_per_category"`
    );
    await queryRunner.query(`DROP TABLE "analytics_remediation_runs"`);
  }
}

/**
 * Add SyncJob outcomeReason Migration
 *
 * Adds `outcomeReason` (nullable varchar) to `sync_jobs` (#1689). A stable
 * code set alongside `outcome` on the succeeded path — e.g. `'master_deleted'`
 * when a master-product-sync job's `business_failure` is caused by the
 * source product having been deleted at its master, distinguishing that from
 * any other business failure (an offer-creation rejection, etc.) in the jobs
 * list UI. Nullable/additive — no existing row is affected.
 *
 * Generated: 2026-07-27, renumbered 2026-07-30 (synthetic sequential prefix
 * per docs/migrations.md #1013 — the original `1832000000000` collided with
 * `main`'s `1832000000000-add-shipment-provider-code.ts`, landed after this
 * branch's prefix was picked; sorts strictly after the current `main` tail
 * `1831000000004`).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSyncJobOutcomeReason1832000000005 implements MigrationInterface {
  name = 'AddSyncJobOutcomeReason1832000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sync_jobs" ADD COLUMN IF NOT EXISTS "outcomeReason" character varying(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sync_jobs" DROP COLUMN IF EXISTS "outcomeReason"`);
  }
}

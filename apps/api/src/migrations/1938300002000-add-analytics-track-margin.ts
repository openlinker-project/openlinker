/**
 * Add `analytics_display_settings.track_margin` (#3588, G11-F)
 *
 * Fifth operator preference on the existing singleton row: whether the UI
 * shows margin and the missing-cost reminders. Display-only - the per-line
 * cost snapshot is written at ingestion whatever this says - so it defaults to
 * `true` and an existing install behaves exactly as before.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsTrackMargin1938300002000 implements MigrationInterface {
  name = 'AddAnalyticsTrackMargin1938300002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analytics_display_settings"
      ADD COLUMN "track_margin" boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analytics_display_settings" DROP COLUMN "track_margin"
    `);
  }
}

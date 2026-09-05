/**
 * Add `analytics_display_settings.net_gross_basis` (#2895)
 *
 * A fourth operator preference on the existing singleton row (#2461): the
 * default VAT basis (`'gross'` | `'net'`) a view opens in when no
 * `?netGrossBasis=` URL override is present — mirrors `rate_basis` exactly
 * (same singleton row, same default-then-URL-override shape).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnalyticsNetGrossBasis1870000007000 implements MigrationInterface {
  name = 'AddAnalyticsNetGrossBasis1870000007000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analytics_display_settings"
      ADD COLUMN "net_gross_basis" text NOT NULL DEFAULT 'gross'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "analytics_display_settings" DROP COLUMN "net_gross_basis"
    `);
  }
}

/**
 * Add the buyer data retention knobs to `operational_settings` (#4289)
 *
 * Four nullable columns: the master switch, the two periods (days, `0` = never)
 * and the erase mode. `NULL` means "not set", which resolves to the code default
 * (switch off, both periods `0`, mode `personal-data`), so an install that
 * upgrades past this migration hides and erases nothing until an admin opts in.
 *
 * Hand-authored like the table's earlier migrations: `migration:generate` would
 * re-emit the sibling `timestamptz` column as `timestamp without time zone`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBuyerDataRetentionSettings1940300000000 implements MigrationInterface {
  name = 'AddBuyerDataRetentionSettings1940300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "buyer_data_retention_enabled" boolean`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "buyer_data_hide_after_days" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "buyer_data_erase_after_days" integer`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "buyer_data_erase_mode" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "buyer_data_erase_mode"`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "buyer_data_erase_after_days"`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "buyer_data_hide_after_days"`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "buyer_data_retention_enabled"`
    );
  }
}

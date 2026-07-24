import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPosthogProductEventsSettings1829000000000 implements MigrationInterface {
  name = 'AddPosthogProductEventsSettings1829000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "posthog_settings"
      ADD COLUMN IF NOT EXISTS "product_events_enabled" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "enabled_event_groups" jsonb NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "posthog_settings"
      DROP COLUMN IF EXISTS "enabled_event_groups",
      DROP COLUMN IF EXISTS "product_events_enabled"
    `);
  }
}

/**
 * Add login_page_settings (#4028)
 *
 * The singleton row holding an admin's per-language login-page copy overrides.
 * `copy` is `{ pl: {...}, en: {...} }`; an empty object means nothing is
 * overridden and every field resolves through env and then the frontend's
 * catalog default. `registration_enabled` NULL means OL_REGISTRATION_ENABLED
 * decides. No row is seeded: an untouched install reads no row.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLoginPageSettings1938400000000 implements MigrationInterface {
  name = 'AddLoginPageSettings1938400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "login_page_settings" (
        "id" text NOT NULL,
        "copy" jsonb NOT NULL DEFAULT '{}',
        "registration_enabled" boolean,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_login_page_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "login_page_settings"`);
  }
}

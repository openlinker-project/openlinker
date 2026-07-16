import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPosthogSettings1825000000000 implements MigrationInterface {
  name = 'AddPosthogSettings1825000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "posthog_settings" (
        "id" text NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "region" text NOT NULL,
        "custom_host" text,
        "autocapture" boolean NOT NULL DEFAULT false,
        "session_recording" boolean NOT NULL DEFAULT false,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_posthog_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "posthog_settings"`);
  }
}

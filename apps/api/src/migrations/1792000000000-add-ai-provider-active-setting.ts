import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAiProviderActiveSetting1792000000000 implements MigrationInterface {
  name = 'AddAiProviderActiveSetting1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "ai_provider_active_setting" (
        "id" text NOT NULL,
        "active_provider" text NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_ai_provider_active_setting" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "ai_provider_active_setting"`);
  }
}

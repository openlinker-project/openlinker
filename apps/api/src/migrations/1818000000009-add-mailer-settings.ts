import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMailerSettings1818000000009 implements MigrationInterface {
  name = 'AddMailerSettings1818000000009';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mailer_settings" (
        "id" text NOT NULL,
        "transport" text NOT NULL,
        "smtp_host" text,
        "smtp_port" integer,
        "smtp_secure" boolean NOT NULL DEFAULT false,
        "from_address" text,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_by" text,
        CONSTRAINT "PK_mailer_settings" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "mailer_settings"`);
  }
}

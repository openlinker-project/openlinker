/**
 * Add email confirmation tokens table
 *
 * Single-use, hashed tokens (mirrors `password_reset_tokens`) that let a
 * self-registered demo user confirm ownership of their email address before
 * the account transitions from `pending_confirmation` to `active` (#1624).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailConfirmationTokens1818000000008 implements MigrationInterface {
  name = 'AddEmailConfirmationTokens1818000000008';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "email_confirmation_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "used_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_confirmation_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_email_confirmation_tokens_user_id" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_email_confirmation_tokens_token_hash" ON "email_confirmation_tokens" ("token_hash")`
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_confirmation_tokens_user_id" ON "email_confirmation_tokens" ("user_id")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_email_confirmation_tokens_user_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_email_confirmation_tokens_token_hash"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "email_confirmation_tokens"`);
  }
}

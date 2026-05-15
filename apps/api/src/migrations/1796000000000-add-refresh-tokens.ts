/**
 * Add refresh_tokens table (#710)
 *
 * Persists server-side refresh tokens for the JWT rotation flow.
 * `rotated_from_id` self-references the table so the rotation chain
 * can be traced for reuse-detection; ON DELETE SET NULL keeps history
 * intact even if a predecessor row is purged.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshTokens1796000000000 implements MigrationInterface {
  name = 'AddRefreshTokens1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "token_hash"      varchar(64) NOT NULL,
        "issued_at"       timestamptz NOT NULL DEFAULT now(),
        "expires_at"      timestamptz NOT NULL,
        "rotated_from_id" uuid NULL,
        "revoked_at"      timestamptz NULL,
        "revoked_reason"  varchar(64) NULL,
        CONSTRAINT "refresh_tokens_rotated_from_id_fkey"
          FOREIGN KEY ("rotated_from_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "refresh_tokens_token_hash_uq" ON "refresh_tokens"("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "refresh_tokens_rotated_from_id_idx" ON "refresh_tokens"("rotated_from_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "refresh_tokens"`);
  }
}

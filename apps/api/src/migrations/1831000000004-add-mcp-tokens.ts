/**
 * Add mcp_tokens table (#1486)
 *
 * Persists OpenLinker-issued MCP Personal Access Tokens (ADR-034). OL acts
 * as an OAuth 2.1 Resource Server validating its own user-issued bearer
 * tokens; this table is that store.
 *
 * Schema mirrors `refresh_tokens` (same bounded context): snake_case
 * columns, SHA-256 `token_hash` in a unique-indexed varchar(64), and a
 * `user_id` FK with ON DELETE CASCADE so deleting a user destroys their
 * credentials.
 *
 * `expires_at` is NOT NULL by hard constraint, not policy: the MCP SDK's
 * bearer verification rejects any AuthInfo whose `expiresAt` is unset, so a
 * "never expires" row could never authenticate.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMcpTokens1831000000004 implements MigrationInterface {
  name = 'AddMcpTokens1831000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mcp_tokens" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "name"           varchar(100) NOT NULL,
        "token_hash"     varchar(64) NOT NULL,
        "scopes"         text[] NOT NULL,
        "resource"       varchar(512) NOT NULL,
        "created_at"     timestamptz NOT NULL DEFAULT now(),
        "expires_at"     timestamptz NOT NULL,
        "last_used_at"   timestamptz NULL,
        "revoked_at"     timestamptz NULL,
        "revoked_reason" varchar(64) NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "mcp_tokens_token_hash_uq" ON "mcp_tokens"("token_hash")`
    );
    await queryRunner.query(`CREATE INDEX "mcp_tokens_user_id_idx" ON "mcp_tokens"("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."mcp_tokens_user_id_idx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "public"."mcp_tokens_token_hash_uq"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mcp_tokens"`);
  }
}

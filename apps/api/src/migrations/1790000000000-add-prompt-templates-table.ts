/**
 * Migration: add `prompt_templates` table
 *
 * Creates the versioned prompt-template storage used by the AI bounded
 * context (#341). Partial unique indexes handle:
 *   - Postgres' NULL-distinct uniqueness on the nullable `channel` column
 *     (two partial indexes cover `channel IS NULL` vs `channel IS NOT NULL`)
 *   - "At most one published row per (key, channel) pair"
 *
 * A CHECK constraint enforces the `state` enum so the application layer
 * can't accidentally write an unknown state value.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPromptTemplatesTable1790000000000 implements MigrationInterface {
  name = 'AddPromptTemplatesTable1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "prompt_templates" (
        "id"                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        "key"                   TEXT        NOT NULL,
        "channel"               TEXT        NULL,
        "version"               INTEGER     NOT NULL,
        "system_prompt"         TEXT        NOT NULL,
        "user_prompt_template"  TEXT        NOT NULL,
        "variables"             JSONB       NOT NULL DEFAULT '[]'::jsonb,
        "state"                 TEXT        NOT NULL,
        "published_at"          TIMESTAMPTZ NULL,
        "created_by"            TEXT        NULL,
        "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "ck_prompt_templates_state"
          CHECK ("state" IN ('draft', 'published', 'archived'))
      )
    `);

    // Version uniqueness per (key, channel). Two partial indexes honour the
    // NULL-distinct uniqueness semantics of Postgres.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_prompt_templates_kcv_master"
        ON "prompt_templates" ("key", "version")
        WHERE "channel" IS NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_prompt_templates_kcv_channel"
        ON "prompt_templates" ("key", "channel", "version")
        WHERE "channel" IS NOT NULL
    `);

    // At most one "published" row per (key, channel). Prevents concurrent
    // double-publish even if the application-level transaction is misused.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_prompt_templates_published_master"
        ON "prompt_templates" ("key")
        WHERE "channel" IS NULL AND "state" = 'published'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "ux_prompt_templates_published_channel"
        ON "prompt_templates" ("key", "channel")
        WHERE "channel" IS NOT NULL AND "state" = 'published'
    `);

    // Lookup index for the list view + version-history scan.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "ix_prompt_templates_key_channel"
        ON "prompt_templates" ("key", "channel", "state")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "ix_prompt_templates_key_channel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_prompt_templates_published_channel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_prompt_templates_published_master"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_prompt_templates_kcv_channel"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "ux_prompt_templates_kcv_master"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "prompt_templates"`);
  }
}

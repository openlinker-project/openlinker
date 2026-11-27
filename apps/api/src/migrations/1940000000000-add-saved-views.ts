/**
 * Create `saved_views` and `saved_view_defaults` (#4241)
 *
 * Personal and shared views are separate uniqueness domains, so name
 * uniqueness is two PARTIAL unique indexes - hand-authored because
 * `migration:generate` does not emit partial indexes. `owner_user_id` is set
 * only for personal views and carries `ON DELETE CASCADE`: a deleted user takes
 * their personal views with them. A shared view is installation-owned and must
 * outlive its author, so it has NO owner (a FK has one delete rule per column;
 * the CHECK pins "personal <=> owner present") and keeps its author in the
 * un-FK'd `created_by_user_id`.
 *
 * The orders column presets are copied by the NEXT migration
 * (`1940100000000-copy-order-column-presets-to-saved-views`), kept separate so
 * the schema and the data move can be reviewed and reverted on their own.
 *
 * `down()` drops both tables.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSavedViews1940000000000 implements MigrationInterface {
  name = 'AddSavedViews1940000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_views" (
        "id"                   uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scope"                text NOT NULL,
        "owner_user_id"        uuid,
        "created_by_user_id"   uuid,
        "page_key"             text NOT NULL,
        "name"                 text NOT NULL,
        "definition"           jsonb NOT NULL,
        "revision"             integer NOT NULL DEFAULT 1,
        "is_workspace_default" boolean NOT NULL DEFAULT false,
        "created_at"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at"           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_saved_views" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_saved_views_scope_owner" CHECK (
          ("scope" = 'personal' AND "owner_user_id" IS NOT NULL)
          OR ("scope" = 'shared' AND "owner_user_id" IS NULL)
        ),
        CONSTRAINT "FK_saved_views_owner" FOREIGN KEY ("owner_user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_saved_views_personal_name"
        ON "saved_views" ("owner_user_id", "page_key", "name")
        WHERE "scope" = 'personal'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_saved_views_shared_name"
        ON "saved_views" ("page_key", "name")
        WHERE "scope" = 'shared'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_saved_views_shared_default"
        ON "saved_views" ("page_key")
        WHERE "scope" = 'shared' AND "is_workspace_default" = true
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_saved_views_page_owner"
        ON "saved_views" ("page_key", "owner_user_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "saved_view_defaults" (
        "user_id"       uuid NOT NULL,
        "page_key"      text NOT NULL,
        "saved_view_id" uuid,
        "updated_at"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_saved_view_defaults" PRIMARY KEY ("user_id", "page_key"),
        CONSTRAINT "FK_saved_view_defaults_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_saved_view_defaults_view" FOREIGN KEY ("saved_view_id")
          REFERENCES "saved_views"("id") ON DELETE CASCADE
      )
    `);

  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_view_defaults"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "saved_views"`);
  }
}

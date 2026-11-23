/**
 * Release center state (#4141, epic #4131, ADR-086)
 *
 * - `user_release_state`: one row per user, the version cursor (display text
 *   plus `major/minor/patch/rank` so the guard is a row comparison) and the
 *   dialog preference.
 * - `release_item_states`: per-item status in installation or user scope, with
 *   one PARTIAL unique index per scope (a single index could not express both,
 *   and the same key must be usable in each), a CHECK tying `userId` to the
 *   scope and a CHECK on `doneVia`. No Postgres enums.
 * - `operational_settings.release_center_enabled`: nullable boolean for the
 *   on/off setting; `NULL` means "not set, fall through to env and default".
 *
 * Hand-authored so names match the ORM entities exactly (the parity spec
 * compares them).
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReleaseCenterState1939900000000 implements MigrationInterface {
  name = 'AddReleaseCenterState1939900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "user_release_state" (
        "userId" uuid NOT NULL,
        "lastSeenVersion" text,
        "major" integer,
        "minor" integer,
        "patch" integer,
        "rank" integer,
        "skipDialog" boolean NOT NULL DEFAULT false,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_release_state" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_user_release_state_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "release_item_states" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "scope" text NOT NULL,
        "userId" uuid,
        "itemKey" text NOT NULL,
        "status" text NOT NULL,
        "doneVia" text,
        "actedByUserId" uuid,
        "snoozedUntil" timestamptz,
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_release_item_states" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_release_item_states_scope_user"
          CHECK (("scope" = 'user') = ("userId" IS NOT NULL)),
        CONSTRAINT "CHK_release_item_states_done_via"
          CHECK ("doneVia" IS NULL OR "doneVia" IN ('auto', 'manual')),
        CONSTRAINT "FK_release_item_states_user" FOREIGN KEY ("userId")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_release_item_states_acted_by" FOREIGN KEY ("actedByUserId")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_release_item_states_installation_key" ON "release_item_states" ("itemKey") WHERE "scope" = 'installation'`
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_release_item_states_user_key" ON "release_item_states" ("userId", "itemKey") WHERE "scope" = 'user'`
    );
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "release_center_enabled" boolean`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "release_center_enabled"`
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_release_item_states_user_key"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_release_item_states_installation_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "release_item_states"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_release_state"`);
  }
}

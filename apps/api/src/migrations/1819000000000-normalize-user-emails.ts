/**
 * Normalize User Emails Migration
 *
 * Backfills `users.email` to trimmed-lowercase so the existing
 * `UQ_users_email` constraint enforces uniqueness case-insensitively (#1625).
 * `UserRepository.save`/`findByEmail` normalize on every future write/read;
 * this migration corrects any row written before that normalization existed.
 *
 * If two existing rows normalize to the same value, this UPDATE fails with a
 * Postgres 23505 unique-violation instead of silently merging the accounts —
 * that is intentional. An operator must resolve the collision (rename or
 * deactivate one of the accounts) before re-running the migration.
 *
 * Idempotent: the WHERE clause only touches rows that aren't already
 * normalized, so re-running after a partial or full success is a no-op.
 *
 * down() is intentionally irreversible — original casing is not preserved,
 * mirroring other data-normalizing migrations in this repo.
 *
 * Generated: 2026-07-15 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class NormalizeUserEmails1819000000000 implements MigrationInterface {
  name = 'NormalizeUserEmails1819000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "users"
         SET "email" = LOWER(TRIM("email"))
       WHERE "email" IS NOT NULL
         AND "email" <> LOWER(TRIM("email"))`,
    );
  }

  public async down(): Promise<void> {
    // intentionally irreversible — original casing is not preserved
  }
}

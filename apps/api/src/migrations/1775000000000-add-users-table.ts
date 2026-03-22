/**
 * Migration: Add users table
 *
 * Creates the `users` table for OpenLinker platform authentication.
 * Stores username, optional email, bcrypt password hash, and timestamps.
 *
 * @module apps/api/src/migrations
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsersTable1775000000000 implements MigrationInterface {
  name = 'AddUsersTable1775000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id"            uuid                NOT NULL DEFAULT gen_random_uuid(),
        "username"      character varying   NOT NULL,
        "email"         character varying,
        "password_hash" character varying   NOT NULL,
        "created_at"    timestamptz         NOT NULL DEFAULT now(),
        "updated_at"    timestamptz         NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id"       PRIMARY KEY ("id"),
        CONSTRAINT "UQ_users_username" UNIQUE ("username"),
        CONSTRAINT "UQ_users_email"    UNIQUE ("email")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
  }
}

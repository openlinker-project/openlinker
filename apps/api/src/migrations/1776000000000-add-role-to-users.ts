/**
 * Migration: Add role column to users table
 *
 * Adds a `role` column to the `users` table for role-based access control.
 * Existing users are backfilled with `admin` role. New users default to `admin`.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoleToUsers1776000000000 implements MigrationInterface {
  name = 'AddRoleToUsers1776000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN "role" character varying(50) NOT NULL DEFAULT 'admin'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN "role"
    `);
  }
}

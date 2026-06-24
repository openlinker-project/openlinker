/**
 * Add warnings to Listing Creation Records Migration
 *
 * Adds a nullable `warnings jsonb` column to `listing_creation_records` so
 * `ProductPublishExecutionService` can persist non-fatal adapter warnings
 * alongside a successful publish (#1131). The column is separate from `errors`
 * (semantic invariant: `errors is not null ↔ status = 'failed'`; warnings
 * coexist with published/draft status). No backfill — all existing rows get
 * NULL, which is the correct "no warnings" value.
 *
 * Generated: 2026-06-23 (synthetic sequential prefix per docs/migrations.md #1013).
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWarningsToListingCreationRecords1810000000000 implements MigrationInterface {
  name = 'AddWarningsToListingCreationRecords1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('listing_creation_records');
    if (!table) {
      return;
    }
    if (!table.findColumnByName('warnings')) {
      await queryRunner.query(
        `ALTER TABLE "listing_creation_records" ADD COLUMN "warnings" jsonb`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "listing_creation_records" DROP COLUMN IF EXISTS "warnings"`,
    );
  }
}

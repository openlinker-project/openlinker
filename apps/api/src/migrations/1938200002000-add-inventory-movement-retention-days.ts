/**
 * Add `inventory_movement_retention_days` (#3565, epic #3512)
 *
 * Nullable Operational Settings column: how long an `inventory_movements` ledger
 * row is kept before the retention sweep deletes it. `NULL` means "not set, fall
 * through to the env var, then the code default (365 days)", so an install that
 * upgrades past this migration behaves byte-identically until an operator sets it.
 *
 * Hand-authored like the table's earlier migrations: `migration:generate` would
 * re-emit the sibling `timestamptz` column as `timestamp without time zone`.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryMovementRetentionDays1938200002000 implements MigrationInterface {
  name = 'AddInventoryMovementRetentionDays1938200002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" ADD COLUMN IF NOT EXISTS "inventory_movement_retention_days" integer`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "operational_settings" DROP COLUMN IF EXISTS "inventory_movement_retention_days"`
    );
  }
}

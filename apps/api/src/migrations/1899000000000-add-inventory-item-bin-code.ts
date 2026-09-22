/**
 * Add `inventory_items."binCode"` (#3402, mockup-parity epic #3401)
 *
 * Bin/shelf-level location granularity for the pack bench redesign
 * (`docs/plans/mockups/pack-bench-redesign.html`). `inventory_locations`
 * (ADR-058 decision 1) names a whole warehouse or site, not a shelf inside
 * one — so a per-position bin code lands on `inventory_items`, the row that
 * already carries the (product, variant, location, source) position key.
 *
 * ## Free text, no format validation
 *
 * Operator-authored, like `Connection.config` free-text fields elsewhere in
 * this codebase. No shape is imposed because bin-naming schemes are entirely
 * warehouse-specific ("A-12-3", "Aisle 4 / Shelf B", …) and OpenLinker has no
 * standing to normalise one.
 *
 * ## No index
 *
 * Nothing filters or sorts by `binCode` in SQL — it is read per-row on the
 * bench (#3410) and carries no routing meaning of its own, unlike
 * `locationId`. An index nothing reads is cost on every write to a table the
 * whole master-sync write path already touches on every tick.
 *
 * ## No default; nullable
 *
 * `null` is the correct state for every row that predates a bin scheme, and
 * for every operator who never adopts one. The ORM entity declares no
 * default either.
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryItemBinCode1899000000000 implements MigrationInterface {
  name = 'AddInventoryItemBinCode1899000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "binCode" TEXT`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "binCode"`);
  }
}

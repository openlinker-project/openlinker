/**
 * Add `inventory_items."binCode"` (#3402, mockup-parity epic #3401)
 *
 * Bin/shelf-level location granularity for the pack bench redesign
 * (`docs/plans/mockups/pack-bench-redesign.html`). `inventory_locations`
 * (ADR-058 decision 1) names a whole warehouse or site, not a shelf inside
 * one — so a per-position bin code lands on `inventory_items`, the row that
 * already carries the (product, variant, location, source) position key.
 *
 * ## Renumbered from `1894000000000`, and what that means for a stand that
 * already ran the old class
 *
 * `subiekt-gt-full-capabilities` claims `1894000000000` too. This side moved,
 * because that branch is not ours.
 *
 * TypeORM decides pending by CLASS NAME, not by timestamp
 * (`MigrationExecutor.js:79` in the pinned 0.3.17 —
 * `!executedMigrations.find((e) => e.name === migration.name)`), so
 * `AddInventoryItemBinCode1899000000000` is a name no `migrations` row holds
 * and it is pending EVERYWHERE — including a database that already applied
 * the 1894-named class. The re-run is harmless: `up()` is
 * `ADD COLUMN IF NOT EXISTS`, so it is a no-op there.
 *
 * What it leaves behind on such a stand is an orphan
 * `AddInventoryItemBinCode1894000000000` row, which `docs/migrations.md` § 6
 * would ordinarily have this `up()` `DELETE`. **No delete is issued**, and
 * that is a statement about where this has run rather than an omission: the
 * demo stand carried 1894/1895/1896 UNAPPLIED when the renumber landed, so
 * there is no orphan anywhere to clean. A reader who does find that row on
 * some other stand can delete it by hand — the recipe is in § 6 — rather than
 * re-deriving why it is there.
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

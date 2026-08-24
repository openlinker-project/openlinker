/**
 * Add inventory_items.sourceConnectionId (#2314, ADR-058 decision 3 — ladder step (i))
 *
 * Records WHICH connection's sync owns an `inventory_items` position. Until now
 * the row carried no provenance at all, which is precisely why the #1904
 * staleness-prune guard has to detect a rival claimant at runtime instead of
 * simply reading the column.
 *
 * This is step (i) of the three-step ADR-058 ladder and **only** step (i):
 * additive, nullable, no `DEFAULT`. On PG11+ that is a catalogue-only change —
 * no table rewrite, no lock beyond the brief `ACCESS EXCLUSIVE` for the DDL.
 * Step (ii) is the `'legacy'`-sentinel backfill (#2317, a `runBoundedSweep`
 * pass — never a migration, because a backfill inside DDL would hold that lock
 * across every existing row). Step (iii) is `SET NOT NULL` plus the index
 * recreation (#2325). Rows are legitimately NULL until step (ii) runs.
 *
 * **Neither partial unique index is touched here** — not
 * `IDX`-on-(`productId`, `locationId`) `WHERE "productVariantId" IS NULL`, nor
 * the one on (`productId`, `productVariantId`, `locationId`)
 * `WHERE "productVariantId" IS NOT NULL`. Adding a NULL-bearing column to a
 * unique index makes the index NULL-distinct, so two rows differing only in an
 * unset provenance would both be admitted — a silent dedup loss that
 * double-counts available-to-promise. Index work waits for step (iii), by which
 * point the column is non-nullable and that failure mode is unreachable.
 *
 * `text`, not `uuid`, and **no FK to `connections`**. Step (ii) writes the
 * literal `'legacy'` sentinel (DESIGN §4.1), which a `uuid` column could not
 * represent at all. The missing FK mirrors `packedByUserId` in
 * `1842000000000-add-order-record-packed.ts`: provenance is an audit fact, so
 * it must survive deletion of the connection it names — the alternatives are
 * blocking the delete or silently erasing who synced the position.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryItemSourceConnectionId1844000000000 implements MigrationInterface {
  name = 'AddInventoryItemSourceConnectionId1844000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" ADD COLUMN IF NOT EXISTS "sourceConnectionId" text`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "inventory_items" DROP COLUMN IF EXISTS "sourceConnectionId"`
    );
  }
}

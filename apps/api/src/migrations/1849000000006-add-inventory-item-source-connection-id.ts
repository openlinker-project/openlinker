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
 * Step (ii) is the `'legacy'`-sentinel backfill (#2317, the
 * `inventory.provenance.backfill` job — never a migration, because a backfill
 * inside DDL would hold that lock across every existing row). It stamps
 * `LEGACY_SOURCE_CONNECTION_ID`, declared in
 * `libs/core/src/inventory/domain/types/inventory.types.ts`; that constant is
 * the single source for the literal, so do not re-spell `'legacy'` here or in a
 * later migration. Step (iii) is `SET NOT NULL` plus the index recreation
 * (#2325). Rows are legitimately NULL until step (ii) has drained.
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
 * `'legacy'` sentinel (DESIGN §4.1), which a `uuid` column could not represent
 * at all. The missing FK mirrors `packedByUserId` in
 * `1849000000004-add-order-record-packed.ts`: provenance is an audit fact, so
 * it must survive deletion of the connection it names — the alternatives are
 * blocking the delete or silently erasing who synced the position.
 *
 * **No supporting index for `WHERE "sourceConnectionId" IS NULL`, deliberately.**
 * The step-(ii) backfill scans on exactly that predicate, up to 12 times an
 * hour at the default cadence, and a partial index would turn each page into
 * an index scan rather than a sequential one. It is still REJECTED, and the
 * acceptance is the point: building an index on `inventory_items` takes a lock
 * on the single table every published quantity derives from — the D2-class
 * hazard the whole bounded-page ladder exists to avoid, incurred to speed up a
 * pass whose entire design goal is to be invisible. `CONCURRENTLY` sidesteps
 * the lock but cannot run inside a migration transaction, so it would become an
 * out-of-band operator step for a temporary benefit. Two things bound the cost
 * instead: each scan is capped by the page limit rather than by table size, and
 * the drain rate is the CRON — `OL_INVENTORY_PROVENANCE_BACKFILL_CRON` is the
 * relief valve on a large table. Once the drain completes the handler
 * short-circuits on its own latch and the predicate is never scanned again, so
 * an index built for it would outlive its only reader.
 *
 * @module apps/api/src/migrations
 */
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddInventoryItemSourceConnectionId1849000000006 implements MigrationInterface {
  name = 'AddInventoryItemSourceConnectionId1849000000006';

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

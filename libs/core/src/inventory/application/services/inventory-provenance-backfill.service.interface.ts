/**
 * Inventory Provenance Backfill Service Interface
 *
 * Contract for ADR-058 ladder step (ii) (#2317): stamp the `'legacy'` sentinel
 * onto `inventory_items` rows that predate the `sourceConnectionId` column
 * (#2314), so step (iii) can make the column `NOT NULL` and fold it into the
 * position key (#2325).
 *
 * One call is one bounded page. The pass makes no platform calls, reads and
 * writes only OpenLinker's own table, and is idempotent: re-running it over an
 * already-stamped table is a no-op, because a stamped row leaves the predicate.
 *
 * @module libs/core/src/inventory/application/services
 */

/**
 * The outcome of one bounded page.
 */
export interface InventoryProvenanceBackfillResult {
  /** Rows this page actually stamped with the sentinel. */
  stamped: number;

  /**
   * Rows still carrying no provenance AFTER the page, counted fresh from the
   * table rather than derived by subtraction. Deriving it would silently drift
   * the moment any other writer inserted a provenance-less row.
   */
  remainingNull: number;

  /**
   * Whether the backfill has nothing left to do.
   *
   * **The predicate is `remainingNull === 0` and nothing else.** In particular
   * it is NOT `stamped === 0`: a page can legitimately stamp zero rows while
   * work remains — every candidate row was locked by a concurrent stock write
   * and skipped — and treating that as completion would latch the sweep off
   * permanently over a transient contention window, leaving rows unstamped that
   * only #2325's failing `SET NOT NULL` would ever reveal. Zero-stamped with
   * work remaining is a retry, not a finish.
   */
  completed: boolean;
}

export interface IInventoryProvenanceBackfillService {
  /**
   * Run one bounded page of the backfill.
   *
   * Takes an already-floored, already-clamped `limit`: bounding is the caller's
   * job, because the payload that supplies it is the caller's to validate.
   */
  runPage(limit: number): Promise<InventoryProvenanceBackfillResult>;
}

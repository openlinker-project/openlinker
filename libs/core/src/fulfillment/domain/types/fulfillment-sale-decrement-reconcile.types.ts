/**
 * Sale-Decrement Reconcile Sweep - domain rules (#3629, epic #3460)
 *
 * The bound on the read half of `inventory.saleDecrement.reconcileSweep`. A
 * routed work whose decrement job was never enqueued leaves the product master's
 * stock high for ever, because the job is event-driven with no cron of its own
 * and a retry of `route()` answers `already-routed` without reaching an enqueue.
 *
 * ## The frontier is "no job was ever enqueued", not "no decrement row"
 *
 * A row-based frontier (a work with a line lacking an `inventory_sale_decrements`
 * row) does not shrink for lines that legitimately never get one: an order item
 * missing from the snapshot is logged and not persisted, a `quantity <= 0` line is
 * skipped, a cancelled order lowers nothing. Each would be re-driven every tick
 * for ever. The exact signature of a LOST enqueue is that `sync_jobs` holds no row
 * with the producers' idempotency key, and a candidate leaves the set by being
 * enqueued - which is what keeps this frontier-as-query with no cursor.
 *
 * A job that was enqueued and then died is deliberately NOT covered: it is an
 * operator-visible dead job, and re-driving it here would loop.
 *
 * @module libs/core/src/fulfillment/domain/types
 */

/**
 * A work younger than this is left alone: its producer may still be mid-enqueue.
 * Racing it would cost nothing in correctness (the shared key dedupes) but adds
 * noise.
 */
const SALE_DECREMENT_RECONCILE_GRACE_DEFAULT_MS = 10 * 60 * 1000;
const SALE_DECREMENT_RECONCILE_GRACE_MIN_MS = 60 * 1000;
const SALE_DECREMENT_RECONCILE_GRACE_MAX_MS = 24 * 60 * 60 * 1000;

/**
 * **The single resolution path** for the grace window (#2229): the cutoff the
 * frontier selects on has exactly one source. A non-finite or non-positive value
 * falls back to the default rather than throwing, since a malformed env var must
 * not wedge a sweep.
 */
export function resolveSaleDecrementReconcileGraceMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SALE_DECREMENT_RECONCILE_GRACE_DEFAULT_MS;
  }
  return Math.min(
    Math.max(parsed, SALE_DECREMENT_RECONCILE_GRACE_MIN_MS),
    SALE_DECREMENT_RECONCILE_GRACE_MAX_MS
  );
}

/**
 * The OLDEST a work may be and still be a candidate. The frontier is "no
 * `sync_jobs` row under the producers' key", and `sync_jobs` has retention
 * (#2946: `succeeded` rows after 30 days by default), so without a floor every
 * old, correctly decremented work would reappear as "no job" the day its row is
 * pruned, and on first deploy every work routed before the decrement existed
 * would lower the master's stock for an order long since handled. The default
 * sits well below the retention floor; the max stays below it too, so no
 * configuration can reopen the window.
 */
const SALE_DECREMENT_RECONCILE_LOOKBACK_DEFAULT_MS = 7 * 24 * 60 * 60 * 1000;
const SALE_DECREMENT_RECONCILE_LOOKBACK_MIN_MS = 60 * 60 * 1000;
const SALE_DECREMENT_RECONCILE_LOOKBACK_MAX_MS = 14 * 24 * 60 * 60 * 1000;

/** The single resolution path for the lookback, with the same fallback rule as the grace. */
export function resolveSaleDecrementReconcileLookbackMs(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return SALE_DECREMENT_RECONCILE_LOOKBACK_DEFAULT_MS;
  }
  return Math.min(
    Math.max(parsed, SALE_DECREMENT_RECONCILE_LOOKBACK_MIN_MS),
    SALE_DECREMENT_RECONCILE_LOOKBACK_MAX_MS
  );
}

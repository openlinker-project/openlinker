/**
 * Shipment Status Sync Types
 *
 * Input/result contract for `IShipmentStatusSyncService.sync` (#838). Mirrors
 * the offer-status-sync shape (#816) so the worker handler that drives it can
 * follow the same cursor-advance pattern.
 *
 * @module libs/core/src/shipping/application/types
 */

export interface ShipmentStatusSyncOptions {
  /** Persisted scan offset (default 0). */
  offset?: number;
  /** Page size. */
  limit: number;
}

export interface ShipmentStatusSyncResult {
  /** Number of shipments visited this run (== page items). */
  scanned: number;
  /** Number of shipments whose row was patched (status/dates/trackingNumber). */
  updated: number;
  /**
   * Number of shipments whose newly-known waybill was relayed to the order's
   * participants this run (#1947). Previously counted only the destination-OMP
   * push; it now counts a successful relay, which reaches the source marketplace
   * too. A shipment skipped because another trigger already holds the relay claim
   * is NOT counted — it produced no outbound write.
   */
  propagated: number;
  /**
   * Number of shipments where per-item processing failed (carrier read, OMP
   * push partial failure) — counted, logged, loop continues. Surfaces in the
   * worker's job audit; not the same as a thrown error which stops the run.
   */
  failed: number;
  /** Total rows matching the scan filter (for cursor wrap). */
  total: number;
  /** Caller's next cursor value (wraps to 0 when reaching `total`). */
  nextOffset: number;
  /**
   * Delivered shipments whose owed `delivered` relay was re-driven by the
   * bounded second pass this run (#3506, G02-7). Independent of the scan page:
   * those rows are `delivered`, which the scan never visits.
   */
  deliveredRelaysRetried: number;
  /** Of `deliveredRelaysRetried`, how many landed and were stamped. */
  deliveredRelaysRecovered: number;
}

/**
 * Re-drive bounds for an owed `delivered` relay (#3506, G02-7).
 *
 * Constants rather than env knobs: they bound a recovery path, not a hot path,
 * and none of them is something an operator tunes per deployment.
 *
 * - LIMIT — rows re-driven per `sync()` call. Each is one lifecycle relay fanned
 *   out to the order's participants, the same unit the waybill relay spends, and
 *   the scan already spends a page of those; 25 keeps a backlog from doubling a
 *   tick (the `fulfillment.work.relaySweep` budget, derived the same way).
 * - RETRY_AFTER — back-off between attempts on one row. Ten minutes is under the
 *   30-minute status-sync cadence, so it never delays a scheduled retry, and it
 *   stops the pass re-driving a row the same tick's scan failed on a moment ago.
 * - MAX_FAILURES — 48 attempts is a day of 30-minute ticks: long enough for an
 *   operator to fix a missing order-state mapping and see it apply on its own,
 *   short enough that a participant that will never accept stops being asked.
 * - MAX_AGE — a delivery older than a week is not re-announced, whatever its count.
 */
export const DELIVERED_RELAY_REDRIVE_LIMIT = 25;
export const DELIVERED_RELAY_RETRY_AFTER_MS = 10 * 60 * 1000;
export const DELIVERED_RELAY_MAX_FAILURES = 48;
export const DELIVERED_RELAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

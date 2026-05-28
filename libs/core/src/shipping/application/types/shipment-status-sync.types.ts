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
  /** Number of shipments where the OMP push (capability B) fired this run. */
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
}

/**
 * Fulfillment Status Sync Types
 *
 * Options + result types for the branch-1 (OMP-fulfilled) shipment status
 * read-back sync service (#834). The shape mirrors the sibling
 * `ShipmentStatusSyncService` (#871) so both worker handlers — the
 * branch-1 and branch-2/3 polls — share a uniform contract.
 *
 * @module libs/core/src/shipping/application/types
 */

export interface FulfillmentStatusSyncOptions {
  /** Page size for the OrderRecord scan. */
  limit: number;
  /** Cursor — the row offset advanced across ticks. Persisted by the worker
   * handler in `connection_cursors`. */
  offset?: number;
  /**
   * Iteration-window bound — only OrderRecords whose `updatedAt` is within
   * this many days from now are scanned. Defaults to
   * `DEFAULT_UPDATED_SINCE_DAYS` (30) when omitted. Operators with longer
   * fulfillment cadences (B2B-with-approval) can widen via the
   * scheduler-task config; in v2 this becomes a per-connection setting.
   */
  updatedSinceDays?: number;
}

/**
 * Default iteration-window bound (days). 30 covers normal B2C cadence;
 * orders untouched for longer are excluded from the scan. Documented as
 * the weakest v1 design call — see plan §6 risks.
 */
export const DEFAULT_UPDATED_SINCE_DAYS = 30;

export interface FulfillmentStatusSyncResult {
  /** Records visited this tick. */
  scanned: number;
  /** New branch-1 Shipment rows created. */
  created: number;
  /** Existing branch-1 Shipment rows patched. */
  updated: number;
  /** Records skipped (routing not branch-1, OMP not yet acted, no externalOrderId, …). */
  skipped: number;
  /** Records where the per-record processing threw — logged at warn, counted here. */
  failed: number;
  /** Total OrderRecords matching the filters (unpaginated). */
  total: number;
  /** Next offset to persist for the cursor. `0` when the scan has wrapped. */
  nextOffset: number;
}

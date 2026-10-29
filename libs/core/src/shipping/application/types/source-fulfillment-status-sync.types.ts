/**
 * Source Fulfillment Status Sync Types
 *
 * Options + result types for the source-side twin of the branch-1 read-back:
 * the sweep that asks an order's SOURCE (a marketplace or a shop OL ingests
 * orders from) whether somebody other than OpenLinker shipped the order there,
 * and records the waybill it reports. Shape mirrors
 * `FulfillmentStatusSyncOptions` / `FulfillmentStatusSyncResult` so the two
 * worker handlers share one cursor contract.
 *
 * @module libs/core/src/shipping/application/types
 */

export interface SourceFulfillmentStatusSyncOptions {
  /** Page size for the OrderRecord scan. */
  limit: number;
  /**
   * Cursor - the row offset advanced across ticks. Persisted by the worker
   * handler in `connection_cursors`.
   */
  offset?: number;
  /**
   * Iteration-window bound - only OrderRecords whose `updatedAt` is within this
   * many days are scanned. Defaults to `DEFAULT_UPDATED_SINCE_DAYS` (30), the
   * same window the destination read-back uses.
   */
  updatedSinceDays?: number;
}

export interface SourceFulfillmentStatusSyncResult {
  /** Records visited this tick. */
  scanned: number;
  /** New source-observed Shipment rows created. */
  created: number;
  /** Existing source-observed rows whose tracking number was filled in. */
  updated: number;
  /**
   * Waybill relays to the order's destinations that LANDED this tick, whether
   * for a row just written or for one re-driven after an earlier failure.
   */
  relayed: number;
  /**
   * Records nothing was learnt from: cancelled, already carrying a known
   * waybill, not dispatched at the source, no source mapping, an unanswered
   * readback, or a waybill that is OpenLinker's own echoed back.
   */
  skipped: number;
  /** Records whose processing threw - logged at warn, counted here. */
  failed: number;
  /** Total OrderRecords matching the filters (unpaginated). */
  total: number;
  /** Next offset to persist for the cursor. `0` when the scan has wrapped. */
  nextOffset: number;
}

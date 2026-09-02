/**
 * Orders Sync Job Payloads (#2440)
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Payload for `orders.taxRate.backfill`.
 *
 * Connection-scoped for the same reason `marketplace.order.fxStampSweep` is
 * (see that job's own comment in `sync-job.types.ts`): the fact being
 * backfilled is connection-agnostic, but `SyncJob.connectionId` is
 * non-nullable, so the per-connection fan-out is also the natural partition
 * of the rate-less frontier — `order_line_items.sourceConnectionId` is a real
 * column on every row, unlike the taxonomy-sync interim scaffold.
 */
export interface OrdersTaxRateBackfillPayloadV1 {
  schemaVersion: 1;
  /** Page size. Handler clamps to its own ceiling regardless of this value. */
  limit: number;
  /**
   * Cursor key on `connection_cursors` this job's handler reads/writes.
   * Optional so a manually-enqueued job can omit it and take the default.
   */
  cursorKey?: string;
}

/**
 * Payload for `orders.holds.reconcile` (#2340).
 *
 * Global rather than connection-scoped: a divergence between `order_holds` and
 * `order_records.activeHoldReason` has no connection axis at all — both tables
 * are OL's own and neither write path involves a platform. The job nonetheless
 * carries a `connectionId` because `SyncJob.connectionId` is non-nullable; the
 * scheduler supplies the nil-UUID system id (the `inventory.provenance.backfill`
 * shape).
 *
 * Carries no cursor: the pass is frontier-as-query, so its remaining work is
 * re-derived from the divergence predicate on every tick rather than resumed
 * from an offset. See `IOrderHoldProjectionReconcileService.runPage`.
 */
export interface OrdersHoldsReconcilePayloadV1 {
  schemaVersion: 1;
  /** Rows repaired per run. Handler clamps regardless of this value. */
  pageLimit?: number;
}

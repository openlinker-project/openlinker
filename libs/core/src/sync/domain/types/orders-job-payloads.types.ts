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

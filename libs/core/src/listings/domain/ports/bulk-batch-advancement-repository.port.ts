/**
 * Bulk Batch Advancement Repository Port
 *
 * Persistence contract for `BulkBatchAdvancement`. Consumed by
 * `BulkOfferCreationProgressService` (gate for at-most-once counter
 * advancement, #737) and `BulkOfferCreationRetryService` (#742, to undo
 * the gate on retry).
 *
 * @module libs/core/src/listings/domain/ports
 */

export interface BulkBatchAdvancementRepositoryPort {
  /**
   * INSERT … ON CONFLICT DO NOTHING on the `bulk_batch_advancements` table.
   *
   * - `{ created: true }` — the row landed (first-time advancement). Caller
   *   should run the counter increment.
   * - `{ created: false }` — the row already existed (retry path, or
   *   concurrent winner). Caller should SKIP the counter increment to
   *   preserve at-most-once semantics.
   *
   * Composite PK `(bulkBatchId, offerCreationRecordId)` guarantees the
   * race-free semantics at the DB level — no transaction needed.
   */
  markAdvancedIfNotExists(
    bulkBatchId: string,
    offerCreationRecordId: string,
  ): Promise<{ created: boolean }>;

  /**
   * Delete the at-most-once advancement row for `(bulkBatchId,
   * offerCreationRecordId)` (#742). Used by retry-failed to undo a
   * previously-counted advancement so the worker handler's next
   * `markAdvancedIfNotExists` call for that record counts the retry
   * wave's outcome — without the delete, the gate would short-circuit
   * and the new outcome would never be reflected on the batch counters.
   *
   * No-op when the row doesn't exist (e.g. the record was never counted).
   */
  deleteForRecord(
    bulkBatchId: string,
    offerCreationRecordId: string,
  ): Promise<void>;
}

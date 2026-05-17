/**
 * Bulk Batch Advancement Repository Port (#737)
 *
 * Persistence contract for `BulkBatchAdvancement`. Sole consumer is
 * `BulkOfferCreationProgressService`, which uses this port to ensure the
 * counter-advancement path is at-most-once per (batch, record) pair across
 * concurrent worker invocations and worker retries.
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
}

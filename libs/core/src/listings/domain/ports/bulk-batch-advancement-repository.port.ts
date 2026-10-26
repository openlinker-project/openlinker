/**
 * Bulk Batch Advancement Repository Port
 *
 * Persistence contract for `BulkBatchAdvancement`. Consumed by
 * `BulkListingProgressService` (gate for at-most-once counter
 * advancement, #737) and `BulkListingRetryService` (#742, to undo
 * the gate on retry).
 *
 * @module libs/core/src/listings/domain/ports
 */
import type { BulkChildOutcome } from '../types/bulk-child-outcome.types';

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
   *
   * `outcome` is stored on the row so a later reclassification can tell which
   * counter this advancement incremented.
   */
  markAdvancedIfNotExists(
    bulkBatchId: string,
    offerCreationRecordId: string,
    outcome: BulkChildOutcome
  ): Promise<{ created: boolean }>;

  /**
   * Move an advancement recorded as `succeeded` to `failed` (E2E-21).
   *
   * ONE conditional UPDATE guarded on `outcome = 'succeeded'`, so it is the
   * at-most-once gate for the counter correction the same way the INSERT is
   * for the original advancement:
   *
   * - `{ reclassified: true }` — this call moved the row. Caller adjusts the
   *   counters (-1 succeeded / +1 failed).
   * - `{ reclassified: false }` — no row, a row already `failed`, or a legacy
   *   row with no recorded outcome. Caller must NOT touch the counters.
   */
  reclassifySucceededAsFailed(
    bulkBatchId: string,
    offerCreationRecordId: string
  ): Promise<{ reclassified: boolean }>;

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

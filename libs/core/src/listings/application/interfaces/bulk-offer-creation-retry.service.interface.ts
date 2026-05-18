/**
 * Bulk Offer Creation Retry Service Interface (#742)
 *
 * Re-enqueues only the failed children of a `BulkOfferCreationBatch`,
 * reopening the batch counters + status so the worker handler's next
 * advancement wave drives terminal-status derivation again.
 *
 * Sibling to:
 *  - `IBulkOfferCreationSubmitService` (#736) — initial submit / HTTP intake.
 *  - `IBulkOfferCreationProgressService` (#737) — counter advancement + terminal-state derivation.
 *
 * Keeps the per-phase orchestration pattern uniform: each phase of the
 * bulk lifecycle (submit → run → progress → retry) is its own service with
 * a single public method.
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { BulkOfferCreationRetryResult } from '../types/bulk-offer-creation-retry.types';

export interface IBulkOfferCreationRetryService {
  /**
   * Re-enqueue every `OfferCreationRecord` for the given batch whose status
   * is `'failed'`. Decrements `failedCount` per retried record (lock-stepped
   * to the per-record reset), then flips a terminal-state batch back to
   * `'running'` so the FE summary reflects the live retry wave. Each
   * retried record is reset to `'pending'`, its `bulk_batch_advancements`
   * row is deleted, and a fresh `marketplace.offer.create` job is
   * enqueued under a wave-distinct idempotency key.
   *
   * Throws:
   * - `BulkOfferCreationBatchNotFoundException` → 404 (unknown batch id).
   * - `NoFailedChildrenToRetryException` → 409 (batch exists but has zero
   *   failed children).
   * - `AdapterCapabilityNotSupportedException` → 422 (connection's adapter
   *   no longer supports `OfferCreator`). Raised before any state mutation.
   * - `BulkRetryMissingSnapshotException` → 500 (failed record has
   *   `request === null` — documented invariant violation, non-retryable).
   */
  retryFailed(batchId: string): Promise<BulkOfferCreationRetryResult>;
}

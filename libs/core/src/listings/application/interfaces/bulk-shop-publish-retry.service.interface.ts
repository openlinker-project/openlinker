/**
 * Bulk Shop Publish Retry Service Interface (#1845)
 *
 * Re-enqueues only the failed children of a shop-publish `BulkListingBatch`,
 * reopening the batch counters + status so the worker handler's next advancement
 * wave drives terminal-status derivation again. The shop-side sibling of
 * `IBulkListingRetryService` (#742) - keeps the per-phase orchestration pattern
 * uniform (submit -> run -> progress -> retry).
 *
 * @module libs/core/src/listings/application/interfaces
 */
import type { BulkShopPublishRetryResult } from '../types/bulk-shop-publish-retry.types';

export interface IBulkShopPublishRetryService {
  /**
   * Re-enqueue every `ListingCreationRecord` for the given batch whose status is
   * `'failed'`. Decrements `failedCount` per retried record (lock-stepped to the
   * per-record reset), then flips a terminal-state batch back to `'running'`.
   * Each retried record is reset to `'pending'`, its `bulk_batch_advancements`
   * row is deleted, and a fresh `shop.product.publish` V2 job is enqueued under a
   * wave-distinct idempotency key rebuilt from the record's `request` snapshot.
   *
   * Throws:
   * - `BulkListingBatchNotFoundException` -> 404 (unknown batch id).
   * - `NoFailedChildrenToRetryException` -> 409 (batch exists, zero failed children).
   * - `AdapterCapabilityNotSupportedException` -> 422 (connection no longer
   *   supports `ProductPublisher`). Raised before any state mutation.
   * - `BulkRetryMissingSnapshotException` -> 500 (failed record has
   *   `request === null` - documented invariant violation, non-retryable).
   */
  retryFailed(batchId: string): Promise<BulkShopPublishRetryResult>;
}

/**
 * Bulk Shop Publish Retry Types (#1845)
 *
 * Result shape returned by `IBulkShopPublishRetryService.retryFailed`. The
 * shop-side sibling of `bulk-listing-retry.types.ts`. Shop publish carries no
 * batch-scoped AI flags, so (unlike the offer retry) there is no `AiFlags`
 * projection here — the per-item `request` snapshot on each `ListingCreationRecord`
 * already carries everything the rebuilt payload needs.
 *
 * @module libs/core/src/listings/application/types
 */
import type { BulkBatchStatus } from '../../domain/types/bulk-listing-batch.types';

export interface BulkShopPublishRetryResult {
  /**
   * Count of records re-enqueued. Always > 0 - `NoFailedChildrenToRetryException`
   * is thrown instead of returning a zero.
   */
  retriedCount: number;

  /** Internal ids of records re-enqueued, ordered by `createdAt ASC`. */
  retriedRecordIds: string[];

  /**
   * UUID assigned to this retry wave. Threaded into each job's idempotency key
   * (`bulk-publish:{batchId}:variant:{variantId}:retry:{retryWaveId}`) so each
   * wave's enqueue is distinct from the original submit's dedup key.
   */
  retryWaveId: string;

  /** Post-retry batch status - `'running'` after a terminal-state reopen. */
  batchStatus: BulkBatchStatus;
}

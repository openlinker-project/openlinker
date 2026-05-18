/**
 * Bulk Offer Creation Retry Types (#742)
 *
 * Result shape returned by `IBulkOfferCreationRetryService.retryFailed`,
 * plus the internal `BulkOfferCreationRetryAiFlags` projection extracted
 * from the parent batch's `sharedConfig` JSONB at retry time. The submit
 * snapshot doesn't carry the AI flags (they're batch-scoped, not
 * per-record), so the retry service rebuilds them once per `retryFailed`
 * invocation and threads them into every per-record V2 payload.
 *
 * `retryWaveId` on the result is internal — surfaced for log correlation
 * + idempotency-key composition. Intentionally NOT mirrored on the wire
 * DTO; re-expose if a future FE wave-history view materialises.
 *
 * @module libs/core/src/listings/application/types
 */
import type { OfferDescriptionTone } from '@openlinker/core/sync';

import type { BulkBatchStatus } from '../../domain/types/bulk-offer-creation-batch.types';

export interface BulkOfferCreationRetryAiFlags {
  generateDescription: boolean;
  descriptionTone?: OfferDescriptionTone;
}

export interface BulkOfferCreationRetryResult {
  /**
   * Count of records re-enqueued. Always > 0 — `NoFailedChildrenToRetryException`
   * is thrown instead of returning a zero.
   */
  retriedCount: number;

  /** Internal IDs of records re-enqueued, ordered by `createdAt ASC`. */
  retriedRecordIds: string[];

  /**
   * UUID assigned to this retry wave. Threaded into each job's idempotency
   * key (`bulk:{batchId}:variant:{variantId}:retry:{retryWaveId}`) so each
   * wave's enqueue is distinct from the original submit's (which carries
   * a 7-day TTL on the dedup key). Internal-only.
   */
  retryWaveId: string;

  /**
   * Post-retry batch status. After a terminal-state reopen this is
   * `'running'`; after retrying inside an already-running batch this is
   * also `'running'` (the status flip is an idempotent no-op write).
   */
  batchStatus: BulkBatchStatus;
}

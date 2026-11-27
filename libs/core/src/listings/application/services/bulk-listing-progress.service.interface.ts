/**
 * Bulk Offer Creation Progress Service Interface (#737)
 *
 * Core state-machine owner for `BulkListingBatch`. Called by the
 * worker's `marketplace.offer.create` handler after each child job
 * terminates, to increment the batch's counters and (when total reached)
 * derive the terminal status — `completed | partially-failed | failed`.
 *
 * Split from `BulkListingSubmitService` (which owns the HTTP-side
 * intake half — submit + transition to `running`) to keep the per-phase
 * orchestration pattern uniform with sibling services
 * (`OfferCreationEnqueueService` / `OfferCreationExecutionService` /
 * `OfferStatusPollService`).
 *
 * @module libs/core/src/listings/application/services
 */
import type { BulkListingBatch } from '../../domain/entities/bulk-listing-batch.entity';
import type { BulkChildOutcome } from '../../domain/types/bulk-child-outcome.types';

export interface IBulkListingProgressService {
  /**
   * Record that a single child offer-creation completed, advance the batch
   * counters accordingly, and derive the terminal status if the batch is
   * now finished.
   *
   * At-most-once across concurrent workers + worker retries: gates on
   * `BulkBatchAdvancementRepositoryPort.markAdvancedIfNotExists`. A retry
   * (or a second concurrent caller for the same record) returns `null`
   * without touching counters.
   *
   * Returns:
   * - The post-update `BulkListingBatch` when the batch reached its
   *   terminal state on this call.
   * - `null` when the batch is still in progress, OR when the advancement
   *   was already recorded (idempotent retry path).
   */
  advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: BulkChildOutcome,
  ): Promise<BulkListingBatch | null>;

  /**
   * Correct a child the batch counted as `succeeded` whose record later
   * terminalised as `failed` (E2E-21: the marketplace accepted the create,
   * then rejected the offer asynchronously). Moves the advancement from
   * succeeded to failed, adjusts the counters by -1 succeeded / +1 failed,
   * and re-derives the terminal status with the same rule
   * `advanceBatchStatus` uses.
   *
   * Replay-safe: the move is one conditional UPDATE on the advancement row,
   * so a second call (a replayed poll) adjusts nothing. A child not yet
   * counted at all is counted as `failed` instead, through the same
   * at-most-once gate as `advanceBatchStatus`.
   *
   * Returns the post-update batch when it is finished (and its status was
   * re-derived on this call), `null` otherwise.
   */
  reclassifyChildAsFailed(
    batchId: string,
    offerCreationRecordId: string
  ): Promise<BulkListingBatch | null>;
}

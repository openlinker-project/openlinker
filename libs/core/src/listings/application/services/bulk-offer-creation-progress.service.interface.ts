/**
 * Bulk Offer Creation Progress Service Interface (#737)
 *
 * The worker-side state-machine owner for `BulkOfferCreationBatch`. Called
 * by the `marketplace.offer.create` handler after each child job completes,
 * to increment the batch's counters and (when total reached) derive the
 * terminal status — `completed | partially-failed | failed`.
 *
 * Split from `BulkOfferCreationSubmitService` (which owns the HTTP-side
 * intake half — submit + transition to `running`) to keep the per-phase
 * orchestration pattern uniform with sibling services
 * (`OfferCreationEnqueueService` / `OfferCreationExecutionService` /
 * `OfferStatusPollService`).
 *
 * @module libs/core/src/listings/application/services
 */
import type { BulkOfferCreationBatch } from '../../domain/entities/bulk-offer-creation-batch.entity';

export interface IBulkOfferCreationProgressService {
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
   * - The post-update `BulkOfferCreationBatch` when the batch reached its
   *   terminal state on this call.
   * - `null` when the batch is still in progress, OR when the advancement
   *   was already recorded (idempotent retry path).
   */
  advanceBatchStatus(
    batchId: string,
    offerCreationRecordId: string,
    outcome: 'succeeded' | 'failed',
  ): Promise<BulkOfferCreationBatch | null>;
}

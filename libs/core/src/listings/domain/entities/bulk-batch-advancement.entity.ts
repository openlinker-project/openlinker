/**
 * Bulk Batch Advancement Domain Entity (#737)
 *
 * Records that a single `OfferCreationRecord`'s outcome has been counted
 * toward its parent `BulkListingBatch`. Acts as the at-most-once
 * guard for the worker handler's counter-advancement path: composite-PK
 * `(bulkBatchId, offerCreationRecordId)` + INSERT-ON-CONFLICT-DO-NOTHING
 * makes the guarantee race-free across N concurrent worker invocations
 * without a transaction.
 *
 * Stays cleanly orthogonal to the single-offer `OfferCreationRecord` —
 * the bulk-flow concern doesn't leak into the per-attempt entity.
 *
 * `outcome` records which counter the advancement incremented, so a child
 * counted as `succeeded` on an accepted create can later be moved to
 * `failed` when the marketplace rejects it asynchronously (E2E-21). `null`
 * on rows written before the column existed: their outcome is unknown, so
 * they are never reclassified.
 *
 * @module libs/core/src/listings/domain/entities
 */
import type { BulkChildOutcome } from '../types/bulk-child-outcome.types';

export class BulkBatchAdvancement {
  constructor(
    public readonly bulkBatchId: string,
    public readonly offerCreationRecordId: string,
    public readonly advancedAt: Date,
    public readonly outcome: BulkChildOutcome | null = null,
  ) {}
}

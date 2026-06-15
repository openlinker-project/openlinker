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
 * @module libs/core/src/listings/domain/entities
 */

export class BulkBatchAdvancement {
  constructor(
    public readonly bulkBatchId: string,
    public readonly offerCreationRecordId: string,
    public readonly advancedAt: Date,
  ) {}
}

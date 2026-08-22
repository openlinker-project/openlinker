/**
 * Offer Quantity Update Types
 *
 * Canonical command and result types for updating offer quantity via
 * `OfferManagerPort.updateOfferQuantity` and `updateOfferQuantitiesBatch`.
 *
 * Domain-only: no framework dependencies.
 *
 * @module libs/core/src/listings/domain/types
 */

/**
 * Command to update a single offer quantity.
 */
export interface UpdateOfferQuantityCommand {
  offerId: string;
  quantity: number;

  /**
   * Optional idempotency key. If absent, core orchestration should generate one deterministically.
   */
  idempotencyKey?: string;

  /**
   * ISO-8601 stamp of the OBSERVATION this write expresses — the inventory position
   * row's `updatedAt`, or the equivalent state-transition time (e.g. a variant's
   * `staleAt`). It is what makes the derived idempotency key distinguish two writes
   * that carry the same quantity, so a corrective write returning an offer to a
   * previously-written value is not silently swallowed by the destination's
   * command-id dedup.
   *
   * MUST NOT be wall-clock `now()`. A wall-clock value collapses dedup to zero and
   * turns every tick into a marketplace write; a value that is stable per observation
   * preserves dedup exactly where it is wanted.
   *
   * Adapters never read this field — it feeds key derivation in core only.
   */
  observedAt?: string;
}

/**
 * Batch command for updating multiple offer quantities.
 */
export interface UpdateOfferQuantitiesBatchCommand {
  items: UpdateOfferQuantityCommand[];

  /**
   * Optional batch-level idempotency key.
   */
  idempotencyKey?: string;
}

export interface UpdateOfferQuantitiesBatchFailure {
  offerId: string;
  errorCode: string;
  message?: string;
}

/**
 * Result for batch quantity update, supporting partial failures.
 */
export interface UpdateOfferQuantitiesBatchResult {
  succeeded: string[]; // offerIds
  failed: UpdateOfferQuantitiesBatchFailure[];
}

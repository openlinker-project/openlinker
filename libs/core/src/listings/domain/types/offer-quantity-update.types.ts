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
   * `staleAt`). One value, two consumers in core orchestration; adapters never read
   * it.
   *
   * It feeds the derived idempotency key, so two writes carrying the same quantity
   * are distinguishable and a corrective write returning an offer to a previously
   * written value is not silently swallowed by the destination's command-id dedup.
   *
   * It is also the staleness guard (#2617): a write whose observation is older than
   * the newest one already written for the offer is refused, so two concurrent
   * writes resolve to the newer quantity whatever order they arrive in.
   *
   * MUST NOT be wall-clock `now()`. A wall-clock value collapses dedup to zero,
   * turns every tick into a marketplace write, and makes the staleness guard
   * meaningless because every write looks newest; a value that is stable per
   * observation preserves both behaviours exactly where they are wanted.
   *
   * Optional: a caller with no observation to quote (the stale-offer pause, which
   * zeroes a listing on its own authority) writes unguarded, exactly as before.
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

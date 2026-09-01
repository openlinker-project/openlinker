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
   * ISO timestamp of the inventory observation this quantity was derived from
   * (#2617). Core orchestration refuses a write whose observation is older than
   * the newest one already written for the offer, so two concurrent writes
   * resolve to the newer quantity whatever order they arrive in.
   *
   * Optional: a caller with no observation to quote (the stale-offer pause,
   * which zeroes a listing on its own authority) writes unguarded, exactly as
   * before.
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

/**
 * Result of one reconcile pass over an adapter's own outstanding
 * asynchronously-acknowledged quantity writes (#2621). Deliberately coarse —
 * the pending-write bookkeeping (which commands, which offers) is adapter-
 * internal, so core only needs aggregate counts to log/report a job result.
 */
export interface PendingQuantityAckReconcileResult {
  /** Resolved to a terminal outcome (succeeded or failed) during this pass. */
  reconciled: number;
  /** Still outstanding — left for the next reconcile pass. */
  stillPending: number;
}

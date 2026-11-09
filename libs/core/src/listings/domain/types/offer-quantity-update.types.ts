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

  /**
   * The internal variant whose stock this write expresses (#4062). Read only by
   * core, to record what was sent for which variant; adapters never read it and
   * it plays no part in what is written. Absent on a caller with no single
   * variant to name (the stale-offer pause) and on a legacy job.
   */
  productVariantId?: string;

  /**
   * The parent product's external id when `offerId` is a variation of a
   * grouped (multi-variant) shop product (#3962). A shop that addresses a
   * variation under its parent (WooCommerce: `products/{parent}/variations/{id}`)
   * needs it; without it the write hits the variation id as if it were a
   * product. Absent for a marketplace offer and for a standalone shop product.
   */
  externalParentId?: string;
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
  /**
   * The original exception when the write threw. Carried so the worker can
   * hand it to the runner's per-platform retry classifier: flattening it to a
   * code and a message made a deterministic refusal look retryable and walked
   * the full retry ladder. Core never inspects it; only the classifier does.
   */
  cause?: Error;
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

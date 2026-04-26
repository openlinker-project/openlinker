/**
 * Offer Creation Invariant Exception
 *
 * Domain exception thrown when `OfferCreationExecutionService.executeCreation`
 * is about to return with the underlying `OfferCreationRecord` still in its
 * initial `pending` status. That state is unreachable in normal flow — the
 * orchestrator either persists a terminal status (`failed`) on a domain
 * rejection or transitions through `draft`/`validating`/`active` on success.
 *
 * Surfacing the violation as a typed exception lets the worker runner
 * classify it as non-retryable (markDead) instead of burning retries on a
 * code bug. See issue #400 (Plan B follow-up to #391).
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferCreationInvariantException extends Error {
  constructor(recordId: string, actualStatus: string) {
    super(
      `OfferCreationRecord ${recordId} returned in invariant-violating status: ` +
        `${actualStatus}. Expected one of: failed | active | draft | validating.`,
    );
    this.name = 'OfferCreationInvariantException';
    Error.captureStackTrace(this, this.constructor);
  }
}

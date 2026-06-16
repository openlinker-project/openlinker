/**
 * Listing Creation Invariant Exception
 *
 * Domain exception thrown when `ProductPublishExecutionService.executePublish`
 * is about to return with the underlying `ListingCreationRecord` still in its
 * initial `pending` status. That state is unreachable in normal flow — the
 * orchestrator either persists a terminal `failed` status on a domain rejection
 * or transitions to `published`/`draft` on success.
 *
 * Surfacing the violation as a typed exception (rather than a bare `Error`) lets
 * the worker runner classify it as a non-retryable code bug and mirrors the
 * offer path's {@link OfferCreationInvariantException}.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class ListingCreationInvariantException extends Error {
  constructor(recordId: string, actualStatus: string) {
    super(
      `ListingCreationRecord ${recordId} returned in invariant-violating status: ` +
        `${actualStatus}. Expected one of: failed | published | draft.`
    );
    this.name = 'ListingCreationInvariantException';
    Error.captureStackTrace(this, this.constructor);
  }
}

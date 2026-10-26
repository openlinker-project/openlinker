/**
 * Offer Stock Restore - Write Incomplete Error
 *
 * Raised when a cancellation restore tried every offer and at least one was not
 * written (the destination rejected it, the transport failed, or the publish
 * Controls could not be resolved).
 *
 * A job failure rather than a quiet skip, for the same reason as the release
 * and reversal siblings: a handler that reports `ok` is never retried, and no
 * reconcile sweep heals a missed stock restore, so the offer would stay at its
 * pre-cancellation quantity. Every offer is attempted before this is thrown, so
 * one bad offer never leaves its siblings unwritten; the retry re-sends the
 * written ones under the same idempotency keys and gives the failed ones
 * another go.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferStockRestoreWriteIncompleteError extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly failedCount: number,
    public readonly errorCodes: readonly string[],
  ) {
    super(
      `Cancellation restore could not write ${failedCount} offer quantit${failedCount === 1 ? 'y' : 'ies'} ` +
        `for order ${internalOrderId} (${errorCodes.join(', ')}); failing the job so the retry re-runs it`,
    );
    this.name = 'OfferStockRestoreWriteIncompleteError';
    Error.captureStackTrace(this, this.constructor);
  }
}

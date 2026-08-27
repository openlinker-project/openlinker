/**
 * Offer Stock Restore — Release Incomplete Error (#2348)
 *
 * Raised when a cancelled order's held reservations could not all be closed.
 *
 * It exists so the failure is a JOB FAILURE rather than a quiet skip. Live holds
 * still stand, so the recomputed available-to-promise is short by exactly those
 * units; publishing it would under-restore a live offer. Returning normally
 * would be worse still — a handler that reports `ok` is never retried, and
 * unlike #1689's stale-offer pause there is no reconcile sweep for the stock
 * restore, so the offer would sit at its pre-cancellation quantity permanently
 * with a healthy-looking job log. The whole cancellation sequence is idempotent,
 * so putting it back on the ordinary retry ladder is the safe answer.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferStockRestoreReleaseIncompleteError extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly failedCount: number,
  ) {
    super(
      `Cancellation release left ${failedCount} reservation row(s) unclosed for order ` +
        `${internalOrderId}; refusing to publish a stock restore while holds are still live`,
    );
    this.name = 'OfferStockRestoreReleaseIncompleteError';
    Error.captureStackTrace(this, this.constructor);
  }
}

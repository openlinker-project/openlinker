/**
 * Offer Stock Restore — Reversal Incomplete Error (#3479)
 *
 * Raised when a cancelled order's sale decrement could not be raised back into
 * its product master for a reason a retry can change (the owner's adapter could
 * not be built, a peer held the position lock, or the reversal itself threw).
 *
 * The master's stock stays lowered for a cancelled sale, and a handler that
 * reports `ok` is never retried while there is no reconcile sweep for the
 * restore. The whole cancellation sequence is idempotent (the release is
 * guarded on `held`, the reversal on its own Postgres claim), so the ordinary
 * retry ladder is the safe answer. A reversal that is `in_doubt` or `blocked`
 * is deliberately NOT this error: no retry can change it, and a blind retry
 * could move stock twice.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferStockRestoreReversalIncompleteError extends Error {
  constructor(
    public readonly internalOrderId: string,
    public readonly failedCount: number,
  ) {
    super(
      `Cancellation reversal left ${failedCount} sale decrement(s) unreversed for order ` +
        `${internalOrderId}; retrying so the product master's stock is given back`,
    );
    this.name = 'OfferStockRestoreReversalIncompleteError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Fulfillment Hold Already Released (#2392)
 *
 * See {@link FulfillmentHoldNotFoundError} for why the two zero-row causes are
 * distinct errors rather than one.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentHoldAlreadyReleasedError extends Error {
  constructor(
    public readonly holdId: string,
    public readonly releasedAt: Date
  ) {
    super(`Fulfillment hold ${holdId} was already released at ${releasedAt.toISOString()}`);
    this.name = 'FulfillmentHoldAlreadyReleasedError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentHoldAlreadyReleasedError);
    }
  }
}

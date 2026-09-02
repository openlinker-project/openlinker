/**
 * Fulfillment Hold Not Found (#2392)
 *
 * One of the two causes a zero-row `releaseHold` can have — the other is
 * {@link FulfillmentHoldAlreadyReleasedError}. They are separated for the reason
 * `OrderHoldRepository.releaseHeld` separates them: "already released" is a
 * benign double-call and "no such hold" is a caller bug, and an operator must be
 * able to tell them apart.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentHoldNotFoundError extends Error {
  constructor(public readonly holdId: string) {
    super(`Fulfillment hold not found: ${holdId}`);
    this.name = 'FulfillmentHoldNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentHoldNotFoundError);
    }
  }
}

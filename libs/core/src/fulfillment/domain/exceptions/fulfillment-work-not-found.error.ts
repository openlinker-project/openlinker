/**
 * Fulfillment Work Not Found (#2392)
 *
 * Raised only where the ABSENCE of the row is a different fact from a
 * precondition that did not hold. Every ordinary axis transition reports
 * `false` ("not applied") instead of throwing, because a caller racing a peer
 * is a normal outcome rather than an error.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentWorkNotFoundError extends Error {
  constructor(public readonly workId: string) {
    super(`Fulfillment work not found: ${workId}`);
    this.name = 'FulfillmentWorkNotFoundError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentWorkNotFoundError);
    }
  }
}

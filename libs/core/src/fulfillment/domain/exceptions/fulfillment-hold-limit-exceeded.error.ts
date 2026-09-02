/**
 * Fulfillment Hold Limit Exceeded (#2392, DESIGN §5.2)
 *
 * Holds are first-class rows, **≤10 active per work**. The cap is enforced in
 * the repository rather than by a database constraint — see
 * `FulfillmentWorkRepository.placeHold` for why a `CHECK` cannot express it and
 * why a trigger would hold in production and silently not in tests.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class FulfillmentHoldLimitExceededError extends Error {
  constructor(
    public readonly workId: string,
    public readonly activeHolds: number,
    public readonly limit: number
  ) {
    super(
      `Fulfillment work ${workId} already carries ${activeHolds} active holds (limit ${limit})`
    );
    this.name = 'FulfillmentHoldLimitExceededError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FulfillmentHoldLimitExceededError);
    }
  }
}

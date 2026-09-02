/**
 * Duplicate Fulfillment Work Line (#2392)
 *
 * The domain translation of a `23505` on
 * `UQ_fulfillment_work_lines_work_order_line`. One order line participates in
 * one work object exactly once — that pair is the line's identity and the
 * update key.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 */
export class DuplicateFulfillmentWorkLineError extends Error {
  constructor(
    public readonly workId: string,
    public readonly orderLineId: string
  ) {
    super(`Fulfillment work ${workId} already carries a line for order line ${orderLineId}`);
    this.name = 'DuplicateFulfillmentWorkLineError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DuplicateFulfillmentWorkLineError);
    }
  }
}

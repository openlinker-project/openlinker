/**
 * Return Refund Observation Invalid Error
 *
 * Raised when a caller asks core to record a `refunded` observation without the
 * source's own instant (#2371).
 *
 * **`refunded` is entered ONLY on observation, and an observation carries the
 * observer's clock** (#2336/#2367). The operator surface renders this state as
 * *"Confirmed by {source}"*; stamping OL's own `new Date()` there would make an
 * OL-authored guess indistinguishable from a marketplace fact, which is the
 * exact confusion the money rail exists to prevent.
 *
 * A caller with no instant should record `triggered` instead — an honest "we
 * asked, and we have not seen it land".
 *
 * @module domain/exceptions
 */
export class ReturnRefundObservationInvalidError extends Error {
  constructor(public readonly returnId: string) {
    super(
      `Cannot record a "refunded" observation for return ${returnId} without the source's own ` +
        'instant — OpenLinker never substitutes its own clock for a channel-reported fact'
    );
    this.name = 'ReturnRefundObservationInvalidError';
    Error.captureStackTrace(this, this.constructor);
  }
}

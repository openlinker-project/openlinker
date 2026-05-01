/**
 * Offer Poll Not Supported Exception
 *
 * Thrown by `OfferStatusPollService` when the adapter resolved for the target
 * connection does not implement the `OfferStatusReader` sub-capability. The
 * service catches this and writes the originating record to `'failed'` with a
 * structured `OFFER_POLL_NOT_SUPPORTED` error code so the operator sees a
 * clear cause rather than a permanently-stuck `'validating'` row.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferPollNotSupportedException extends Error {
  constructor(connectionId: string) {
    super(
      `Offer status polling is not supported by the adapter for connection ${connectionId}: ` +
        `the adapter must implement OfferStatusReader to participate in async-validation polling.`,
    );
    this.name = 'OfferPollNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}

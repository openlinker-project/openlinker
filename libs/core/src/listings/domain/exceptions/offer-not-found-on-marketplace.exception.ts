/**
 * Offer Not Found On Marketplace Exception
 *
 * Thrown by an `OfferStatusReader` adapter when the marketplace returns 404
 * for the requested offer id (e.g. Allegro `GET /sale/product-offers/{id}`).
 * The poll service catches this and writes the originating record to
 * `'failed'` with an `OFFER_NOT_FOUND` error code — terminal, no further
 * polling.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferNotFoundOnMarketplaceException extends Error {
  constructor(
    public readonly externalOfferId: string,
    public readonly connectionId: string,
  ) {
    super(
      `Offer not found on marketplace: externalOfferId=${externalOfferId} connectionId=${connectionId}`,
    );
    this.name = 'OfferNotFoundOnMarketplaceException';
    Error.captureStackTrace(this, this.constructor);
  }
}

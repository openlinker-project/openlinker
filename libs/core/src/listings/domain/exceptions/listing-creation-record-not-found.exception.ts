/**
 * Listing Creation Record Not Found Exception
 *
 * Thrown by `ListingCreationRecordRepositoryPort` update paths when the target
 * row does not exist. Mirrors `OfferCreationRecordNotFoundException`.
 *
 * @module libs/core/src/listings/domain/exceptions
 */

export class ListingCreationRecordNotFoundException extends Error {
  constructor(public readonly recordId: string) {
    super(`Listing creation record not found: ${recordId}`);
    this.name = 'ListingCreationRecordNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

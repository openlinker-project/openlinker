/**
 * Offer Creation Record Not Found Exception
 *
 * Domain exception thrown when an OfferCreationRecord with the specified ID
 * does not exist. Raised by the repository on update paths that require the
 * record to already exist (e.g. updating status or assigning externalOfferId).
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class OfferCreationRecordNotFoundException extends Error {
  constructor(id: string) {
    super(`Offer creation record not found: ${id}`);
    this.name = 'OfferCreationRecordNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Duplicate Offer Mapping Error
 *
 * Domain exception thrown when attempting to create an offer mapping
 * that already exists. This error is thrown by the repository when a unique
 * constraint violation occurs, allowing the service to handle concurrency
 * cases appropriately.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class DuplicateOfferMappingError extends Error {
  constructor(
    connectionId: string,
    offerId: string,
  ) {
    super(
      `Offer mapping already exists for connection ${connectionId} and offer ${offerId}`,
    );
    this.name = 'DuplicateOfferMappingError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}



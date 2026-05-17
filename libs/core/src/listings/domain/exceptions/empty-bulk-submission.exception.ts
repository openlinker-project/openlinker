/**
 * Empty Bulk Submission Exception
 *
 * Domain exception raised by `BulkOfferCreationSubmitService.submit` when
 * the caller passes an empty `productIds` array. The controller DTO
 * already enforces `@IsArray @ArrayMinSize(1) @ArrayMaxSize(100)`, so
 * surfacing this exception means the service was reached via an internal
 * caller — kept distinct so the controller layer can map it to HTTP 400
 * with the same shape as the DTO-validation error.
 *
 * @module libs/core/src/listings/domain/exceptions
 */
export class EmptyBulkSubmissionException extends Error {
  constructor() {
    super('Bulk offer creation requires at least one productId');
    this.name = 'EmptyBulkSubmissionException';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Customer Projection Exception
 *
 * Domain exception thrown when customer projection operations fail due to
 * validation errors or invalid data. Used for projection-specific errors
 * like missing required fields or invalid customer IDs.
 *
 * @module libs/core/src/customers/domain/exceptions
 */
export class CustomerProjectionException extends Error {
  constructor(
    message: string,
    public readonly internalCustomerId?: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'CustomerProjectionException';
    Error.captureStackTrace(this, this.constructor);
  }
}

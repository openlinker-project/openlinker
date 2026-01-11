/**
 * Order Record Not Found Exception
 *
 * Domain exception thrown when attempting to access an order record that does not exist.
 * This error is thrown by the repository when an order record is not found, allowing
 * the service to handle the case appropriately.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderRecordNotFoundException extends Error {
  constructor(public readonly internalOrderId: string) {
    super(`Order record not found: ${internalOrderId}`);
    this.name = 'OrderRecordNotFoundException';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderRecordNotFoundException);
    }
  }
}

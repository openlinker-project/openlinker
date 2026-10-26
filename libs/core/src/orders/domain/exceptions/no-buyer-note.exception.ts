/**
 * No Buyer Note Exception
 *
 * Raised when an operator asks to mark an order's buyer note read but the order
 * carries no note (#3538, B-8): there is nothing to read, so a marker would be a
 * false fact.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class NoBuyerNoteException extends Error {
  constructor(public readonly internalOrderId: string) {
    super(`Order has no buyer note to mark read: ${internalOrderId}`);
    this.name = 'NoBuyerNoteException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, NoBuyerNoteException);
    }
  }
}

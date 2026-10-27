/**
 * Refund Lock Unavailable Exception (#3289, R-16)
 *
 * The per-order refund lock could not be taken in time - the lock store is not
 * answering. Retryable: nothing was written, and nothing will be written later,
 * because the work only runs once the lock is held.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class RefundLockUnavailableException extends Error {
  readonly code = 'refund_lock_unavailable';

  constructor(readonly internalOrderId: string) {
    super(
      `The refund for order ${internalOrderId} could not be recorded right now; nothing was recorded. Retry in a moment`
    );
    this.name = 'RefundLockUnavailableException';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Order Sync Start Unavailable Error
 *
 * Raised when the operator's chosen order-sync start (#4228) can never be
 * applied to this connection as it stands: the adapter cannot start from a date,
 * or the shop refuses the filter that would do it. The condition is
 * deterministic, so the poll job reports a business failure instead of burning
 * its whole retry ladder on an answer retrying cannot change. Transient read
 * failures (network, 5xx, 429) are NOT this error and keep retrying.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderSyncStartUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderSyncStartUnavailableError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderSyncStartUnavailableError);
    }
  }
}

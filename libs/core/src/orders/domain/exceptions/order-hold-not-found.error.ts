/**
 * Order Hold Not Found Error (#2338)
 *
 * Raised by `OrderHoldRepositoryPort.releaseHeld` when the hold id does not
 * exist at all — as distinct from existing and already being released, which is
 * `HoldAlreadyReleasedError`.
 *
 * Both arise from the same "zero rows affected" observation, and collapsing them
 * would make the port state something it does not know: that a hold which never
 * existed had been released. See `HoldAlreadyReleasedError`.
 *
 * NOT retryable.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderHoldNotFoundError extends Error {
  constructor(public readonly holdId: string) {
    super(`Order hold ${holdId} not found`);
    this.name = 'OrderHoldNotFoundError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderHoldNotFoundError);
    }
  }
}

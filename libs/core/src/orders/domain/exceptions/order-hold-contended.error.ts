/**
 * Order Hold Contended Error (#2338 review)
 *
 * Raised by `OrderHoldRepositoryPort.placeIfNoneOpen` when the insert lost the
 * `UQ_order_holds_open_order` race AND the winning hold was released before the
 * loser could read it — so the slot is free again and neither
 * `OrderAlreadyOnHoldError` ("the order is held") nor the raw driver error is a
 * true statement.
 *
 * **Retryable, and that is the whole point.** The previous code re-threw the
 * `QueryFailedError` here, which the port's own docblock forbids and which the
 * HTTP layer answered as a 500 carrying a duplicate-key message. A re-run of
 * `place()` lands on a clean insert, so this reports contention rather than
 * failure — the `InvoiceIssueContendedException` precedent (a 409 whose remedy
 * is "try again", distinct from the 409 whose remedy is "look at the open
 * hold").
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderHoldContendedError extends Error {
  constructor(public readonly internalOrderId: string) {
    super(
      `Placing a hold on order ${internalOrderId} is contended: a concurrent hold took and ` +
        `released the slot — retry`
    );
    this.name = 'OrderHoldContendedError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderHoldContendedError);
    }
  }
}

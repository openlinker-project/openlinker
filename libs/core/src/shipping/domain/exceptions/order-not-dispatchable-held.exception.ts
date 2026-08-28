/**
 * Order Not Dispatchable (Held) Exception (#2339, DESIGN §6.4)
 *
 * Thrown by `ShipmentDispatchService` when the order carries an open hold. The
 * sibling of `OrderNotDispatchablePaymentStatusException` — same choke point,
 * same 422 — and deliberately a DISTINCT type rather than a code on that one:
 * the two refusals have different remedies (settle the payment vs release the
 * hold) and the operator has to be told which.
 *
 * **Terminal, never retryable** (ADR-007): a hold is a persisted-state fact, so
 * repeating the dispatch cannot change it. A caller that classifies dispatch
 * failures must route this to `business_failure` and stop, not into a backoff
 * ladder that will fail identically for as long as the operator leaves the hold
 * in place.
 *
 * The hold's `reason` rides along so the message names WHY the order is held —
 * `payment-review` and `stock-shortfall` are different conversations.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class OrderNotDispatchableHeldException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly holdId: string,
    public readonly holdReason: string
  ) {
    super(
      `Order ${orderId} cannot be dispatched: it is on hold (${holdId}, reason '${holdReason}')`
    );
    this.name = 'OrderNotDispatchableHeldException';
    Error.captureStackTrace(this, this.constructor);
  }
}

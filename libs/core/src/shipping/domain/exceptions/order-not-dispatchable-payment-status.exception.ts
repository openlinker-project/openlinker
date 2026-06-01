/**
 * Order Not Dispatchable (Payment Status) Exception
 *
 * Thrown by `ShipmentDispatchService` when an order's neutral payment status
 * (#928) is in the dispatch block set (`awaiting` | `refunded`). This is the
 * server-side enforcement of the gate the FE renders as a disabled
 * Generate-label CTA (#938) — the durable guarantee that belongs server-side
 * per `docs/frontend-architecture.md` (the FE must not be the source of truth
 * for business/authorization rules). Mapped to HTTP 422 at the controller.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */

export class OrderNotDispatchablePaymentStatusException extends Error {
  constructor(
    public readonly orderId: string,
    public readonly paymentStatus: string,
  ) {
    super(
      `Order ${orderId} cannot be dispatched: payment status is '${paymentStatus}'`,
    );
    this.name = 'OrderNotDispatchablePaymentStatusException';
    Error.captureStackTrace(this, this.constructor);
  }
}

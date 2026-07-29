/**
 * Shipment Dispatch Contended Exception
 *
 * Thrown by ShipmentDispatchService when the per-order dispatch lock is held by
 * a concurrent request AND no active shipment exists yet for the order - i.e.
 * another caller is mid-dispatch but has not persisted its row. It is a
 * **retryable** signal, and critically a "nothing was charged" signal: this
 * attempt issued no `generateLabel` call, so no carrier label was minted by it.
 *
 * Distinct from a carrier rejection (`ShippingProviderRejectionException`,
 * mapped to 502) - the carrier was never reached. Mapped to HTTP 409 so the
 * operator sees "already being dispatched" rather than an unclassified 500.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShipmentDispatchContendedException extends Error {
  constructor(public readonly orderId: string) {
    super(
      `Dispatch is already in progress for order ${orderId}; no label was created by this attempt - retry`,
    );
    this.name = 'ShipmentDispatchContendedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ShipmentDispatchContendedException);
    }
  }
}

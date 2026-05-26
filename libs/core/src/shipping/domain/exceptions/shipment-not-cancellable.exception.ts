/**
 * Shipment Not Cancellable Exception
 *
 * Thrown by `ShipmentCancellationService` when a shipment is in a state that
 * can no longer be cancelled — it has already dispatched / is in transit, or
 * has reached a terminal state (`delivered` / `failed`). Distinct from
 * `ShipmentCancellationNotSupportedException` (which is about the provider
 * adapter lacking the `ShipmentCanceller` capability) so callers can render a
 * "can't cancel anymore" message separately from "this carrier doesn't support
 * cancel". Maps to HTTP 409 at the API boundary.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShipmentNotCancellableException extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly reason: string,
  ) {
    super(`Shipment ${shipmentId} cannot be cancelled: ${reason}`);
    this.name = 'ShipmentNotCancellableException';
    Error.captureStackTrace(this, this.constructor);
  }
}

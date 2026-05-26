/**
 * Shipment Cancellation Not Supported Exception
 *
 * Thrown by `ShipmentCancellationService` when the resolved shipping-provider
 * adapter for the shipment's connection does not implement the
 * `ShipmentCanceller` sub-capability — i.e. the carrier integration cannot
 * void a shipment. Distinct from `ShipmentNotCancellableException` (wrong
 * lifecycle state) so the API surface can return 422 (capability gap) rather
 * than 409 (state conflict).
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class ShipmentCancellationNotSupportedException extends Error {
  constructor(
    public readonly shipmentId: string,
    public readonly connectionId: string,
  ) {
    super(
      `Shipment ${shipmentId} cannot be cancelled: connection ${connectionId} does not support shipment cancellation`,
    );
    this.name = 'ShipmentCancellationNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}

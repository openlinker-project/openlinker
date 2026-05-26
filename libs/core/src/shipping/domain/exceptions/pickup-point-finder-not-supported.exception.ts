/**
 * Pickup-Point Finder Not Supported Exception
 *
 * Thrown by `PickupPointLookupService` when the resolved connection's
 * `ShippingProviderManagerPort` does not implement the `PickupPointFinder`
 * sub-capability (e.g. a courier-only carrier with no locker network). Mapped
 * to HTTP 422 at the controller boundary.
 *
 * @module libs/core/src/shipping/domain/exceptions
 */
export class PickupPointFinderNotSupportedException extends Error {
  constructor(connectionId: string) {
    super(`Connection does not support pickup-point lookup: ${connectionId}`);
    this.name = 'PickupPointFinderNotSupportedException';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Shipment Canceller Capability
 *
 * Optional sub-capability of `ShippingProviderManagerPort` — adapters that
 * can void a not-yet-dispatched shipment declare `implements
 * ShipmentCanceller`. Call sites narrow via `isShipmentCanceller(adapter)`
 * before invoking `cancelShipment`; after the guard TypeScript knows the
 * method is present.
 *
 * Mirrors the listings sub-capability pattern (e.g. `OfferCanceller`,
 * `OfferCreator`) per engineering-standards §"Port sub-capabilities".
 *
 * @module libs/core/src/shipping/domain/ports/capabilities
 */

import type { ShippingProviderManagerPort } from '../shipping-provider-manager.port';

export interface ShipmentCanceller {
  /**
   * Void a shipment that has not yet dispatched. Behavior on dispatched
   * shipments is provider-specific (often a no-op or 4xx); callers should
   * check `Shipment.status` before invoking. The cancellation may accrue
   * a small provider fee even on success — that's a domain decision, not
   * a port concern.
   */
  cancelShipment(input: { providerShipmentId: string }): Promise<void>;
}

export function isShipmentCanceller(
  adapter: ShippingProviderManagerPort,
): adapter is ShippingProviderManagerPort & ShipmentCanceller {
  return typeof (adapter as Partial<ShipmentCanceller>).cancelShipment === 'function';
}

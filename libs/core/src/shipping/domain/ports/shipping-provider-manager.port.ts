/**
 * Shipping Provider Manager Port
 *
 * Canonical capability contract for shipping-provider adapters (InPost ShipX
 * via #764, future Allegro Delivery via #732, …). The base port carries
 * the three methods every shipping adapter must implement; optional
 * methods (cancel, pickup-point search) live as distinct sub-capability
 * interfaces under `./capabilities/` per engineering-standards §"Port
 * sub-capabilities" (mirrors the listings #337 pattern).
 *
 * Adapters declare extra capabilities via `implements`:
 *
 *   class InpostShippingProviderAdapter
 *     implements ShippingProviderManagerPort, ShipmentCanceller, PickupPointFinder { … }
 *
 * Call sites narrow capability support via the co-located type guards
 * (`isShipmentCanceller`, `isPickupPointFinder`) rather than presence
 * checks on optional methods.
 *
 * Port shape deviates from the #727 product-spec literal 4-string
 * `getCapabilities()` vocabulary by design — see implementation plan
 * §1.1 for the mapping (paczkomat-shipment / kurier-domestic-shipment →
 * `getSupportedMethods()`; cancel-shipment → `ShipmentCanceller`
 * sub-port; tracking-webhooks → derived from `WebhookProvisioningRegistry`
 * at the host).
 *
 * Domain-only — zero framework imports.
 *
 * @module libs/core/src/shipping/domain/ports
 */

import type { ShippingMethod } from '../types/shipping-method.types';
import type {
  GenerateLabelCommand,
  GenerateLabelResult,
} from '../types/generate-label.types';
import type { TrackingSnapshot } from '../types/tracking-snapshot.types';

export interface ShippingProviderManagerPort {
  /**
   * Generate a shipping label for a shipment that has been persisted in
   * `draft` status. Adapter writes the resulting `providerShipmentId`,
   * `trackingNumber` (if returned synchronously), and `labelPdfRef` to
   * the returned result; the caller persists them via
   * `ShipmentRepositoryPort.update`.
   *
   * Adapters MUST throw if `cmd.shippingMethod` isn't in their
   * `getSupportedMethods()`.
   */
  generateLabel(cmd: GenerateLabelCommand): Promise<GenerateLabelResult>;

  /**
   * Read the latest tracking snapshot for a shipment from the provider.
   * Required on every adapter because the polling-fallback path (#772)
   * is always available as a degradation strategy when webhooks aren't
   * provisioned or have dropped.
   */
  getTracking(input: { providerShipmentId: string }): Promise<TrackingSnapshot>;

  /**
   * Declares which `ShippingMethod` values this adapter accepts for
   * `generateLabel`. Static per adapter — does NOT change at runtime.
   *
   * The FE's AC-11 capability-conditional rendering ("if no connection
   * declares paczkomat-shipment or kurier-domestic-shipment, InPost-
   * specific terminology does NOT appear") is driven by this method,
   * mapped to the legacy capability strings at the API-response seam.
   */
  getSupportedMethods(): readonly ShippingMethod[];
}

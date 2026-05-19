/**
 * Generate Label Types
 *
 * Port-input/output types for `ShippingProviderManagerPort.generateLabel`.
 * Lives in a dedicated `*.types.ts` file per engineering-standards §"Type
 * Definitions in Separate Files" (mirrors listings'
 * `offer-create.types.ts` precedent — port files contain only the port
 * interface; their types live here).
 *
 * NOTE: no `platformParams` / `overrides` escape hatch in this foundation
 * slice. When #764 (InPost adapter) needs adapter-specific fields (parcel
 * dims, sender-address override, etc.), that PR adds them — either as
 * typed optional fields on the canonical command, or as a typed
 * `GenerateLabelOverrides` interface (mirroring listings'
 * `CreateOfferOverrides` shape) with `platformParams?: Record<string,
 * unknown>` as the bottom-of-stack escape hatch. Adding optional fields
 * is forward-compatible; speculating now would risk locking in the wrong
 * shape before two real adapters (#764 + future #732) reveal what's
 * shared vs adapter-specific.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { ShippingMethod } from './shipping-method.types';

export interface GenerateLabelCommand {
  /** Internal Shipment id (`ol_shipment_*`). */
  shipmentId: string;
  /** Internal order id (`ol_order_*`). */
  orderId: string;
  /** Shipping-provider connection that should issue the label. */
  connectionId: string;
  /** Which shipping shape the adapter should produce. Adapters MUST throw
   * if this value isn't in their `getSupportedMethods()`. */
  shippingMethod: ShippingMethod;
  /** Required when `shippingMethod === 'paczkomat'`. Provider-issued
   * locker id (e.g. `'POZ08A'`). */
  paczkomatId?: string;
}

export interface GenerateLabelResult {
  /** Provider-issued shipment id. Used to look up tracking + cancel. */
  providerShipmentId: string;
  /** Carrier tracking number when the provider returns one synchronously.
   * Some providers issue tracking asynchronously (separate webhook); in
   * that case this stays null at label-generation time and is set later
   * via `ShipmentRepositoryPort.update`. */
  trackingNumber: string | null;
  /** Adapter-supplied opaque reference to the generated label PDF. Shape
   * is adapter-defined (absolute URL, blob id, signed link, …); consumers
   * should not interpret it beyond passing it back to the adapter or
   * rendering as a link. */
  labelPdfRef: string;
}

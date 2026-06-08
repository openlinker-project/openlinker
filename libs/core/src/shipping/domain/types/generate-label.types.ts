/**
 * Generate Label Types
 *
 * Port-input/output types for `ShippingProviderManagerPort.generateLabel`.
 * Lives in a dedicated `*.types.ts` file per engineering-standards §"Type
 * Definitions in Separate Files" (mirrors listings'
 * `offer-create.types.ts` precedent — port files contain only the port
 * interface; their types live here).
 *
 * #764 (InPost) added the `recipient` + `parcel` fields below. They're
 * carrier-neutral — every shipping provider needs a recipient and a parcel
 * descriptor — so they live on the canonical command rather than behind a
 * `platformParams` escape hatch. Provider-specific translation (ShipX
 * `service` / `custom_attributes.target_point`, courier-vs-locker parcel
 * shape, etc.) stays inside each adapter. A future provider needing a
 * genuinely adapter-specific input should add a typed optional field here
 * (or a `GenerateLabelOverrides` interface) — never an untyped bag.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { ShippingMethod } from './shipping-method.types';
import type { ShipmentRecipient } from './shipment-recipient.types';
import type { ShipmentParcel } from './shipment-parcel.types';

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
  /** Resolved provider-side delivery-method id the adapter sends to its API
   * (e.g. Allegro `/shipment-management` `deliveryMethodId`). Resolved
   * upstream at dispatch from the source method behind a seam (#833 ADR-012);
   * own-contract adapters (InPost) ignore it. Source-brokered adapters that
   * require it MUST throw a readable error when it is absent. */
  deliveryMethodId?: string;
  /** Required when `shippingMethod === 'paczkomat'`. Provider-issued
   * locker id (e.g. `'POZ08A'`). */
  paczkomatId?: string;
  /** Recipient (buyer) — name, contact, optional postal address. The caller
   * resolves it from the order. Adapters require `recipient.address` for
   * courier methods. */
  recipient: ShipmentRecipient;
  /** Parcel descriptor — a carrier size `template` (locker) or
   * `dimensions` + `weightGrams` (courier). The adapter validates the right
   * combination per method. */
  parcel: ShipmentParcel;
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

/**
 * Shipping Method Types
 *
 * Discriminates the kind of shipment a `ShippingProviderManagerPort`
 * adapter can produce. Each value corresponds to a different ShipX (or
 * equivalent) endpoint shape on the provider side. The runtime-discoverable
 * answer to "what shipment kinds does this adapter support?" is
 * `ShippingProviderManagerPort.getSupportedMethods()`, which returns a
 * `readonly ShippingMethod[]`.
 *
 * Future adapters (e.g. #732 Allegro Delivery) may add new values here as
 * new shipping models surface. Removing a value requires a coordinated
 * migration; adding one is a forward-compatible change.
 *
 * @module libs/core/src/shipping/domain/types
 */

export const ShippingMethodValues = ['paczkomat', 'kurier'] as const;
export type ShippingMethod = (typeof ShippingMethodValues)[number];

export const SHIPPING_METHOD = {
  Paczkomat: 'paczkomat',
  Kurier: 'kurier',
} as const satisfies Record<'Paczkomat' | 'Kurier', ShippingMethod>;

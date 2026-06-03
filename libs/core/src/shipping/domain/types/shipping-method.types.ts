/**
 * Shipping Method Types
 *
 * Discriminates the kind of shipment OL persists on a `Shipment` row. The
 * runtime-discoverable answer to "what shipment kinds does a given
 * `ShippingProviderManagerPort` adapter support?" is
 * `getSupportedMethods()`, which returns a `readonly ShippingMethod[]`.
 *
 * Two flavours of value live in the same union:
 *
 * - **Provider-issued methods** — `paczkomat` (locker), `pickup` (parcel-shop /
 *   PUDO point — DPD Pickup #963; carrier-neutral, distinct from the
 *   `paczkomat` locker), `kurier` (and future ones for #732 Allegro Delivery):
 *   each maps to a different endpoint shape on the provider side, and a
 *   label-issuing `ShippingProviderManagerPort` adapter is the row's
 *   authoritative writer.
 * - **Projection-only methods** — `omp` (#834, ADR-012): branch-1
 *   shipments where the destination OMP ships externally and OL holds no
 *   provider id, no `labelPdfRef`. The row exists as a *projection* of
 *   the OMP's state, populated by `FulfillmentStatusSyncService`. No
 *   `ShippingProviderManagerPort` ever advertises `omp`.
 *
 * Adding a new provider-issued value is a forward-compatible change;
 * removing any value requires a coordinated migration.
 *
 * @module libs/core/src/shipping/domain/types
 */

export const ShippingMethodValues = ['paczkomat', 'pickup', 'kurier', 'omp'] as const;
export type ShippingMethod = (typeof ShippingMethodValues)[number];

export const SHIPPING_METHOD = {
  Paczkomat: 'paczkomat',
  Pickup: 'pickup',
  Kurier: 'kurier',
  Omp: 'omp',
} as const satisfies Record<'Paczkomat' | 'Pickup' | 'Kurier' | 'Omp', ShippingMethod>;

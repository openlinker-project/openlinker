/**
 * Tracking Snapshot Types
 *
 * Port output for `ShippingProviderManagerPort.getTracking`. Separate file
 * so the polling-fallback service (#772) and webhook ingestion handler
 * (#768) can value-import the snapshot type without pulling in the rest
 * of the port surface.
 *
 * Status mapping is the adapter's responsibility: every adapter maps its
 * provider-native status string to OL's canonical `ShipmentStatus` at the
 * port boundary. The raw provider value is carried through in
 * `providerStatus` for diagnostics / log forensics — core code never
 * branches on it.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { ShipmentStatus } from './shipment-status.types';

/**
 * Canonical lowercase-kebab vocabulary for the actual carrier-of-record (#769).
 *
 * The carrier-of-record is **distinct from the dispatcher**. Allegro Delivery
 * is a brokerage that subcontracts to ~9 carriers (per product-spec #732 §3.2);
 * a shipment whose dispatcher is `'allegro'` may physically be an InPost,
 * DPD, or ORLEN waybill. Keying tracking-URL composition on the carrier (not
 * the dispatcher) is the durable model — same shape applies to PS-fulfilled
 * shipments (#834) where PrestaShop is the dispatcher and the underlying
 * carrier comes from PS's `order_carriers.id`.
 *
 * **Closed-core, open-runtime, closed-FE asymmetry** (#576 pattern, mirrors
 * `CoreCapabilityValues` / `CoreCapability`):
 * - This `KnownCarrierValues` is the closed core vocabulary.
 * - The `TrackingSnapshot.carrier` and `Shipment.carrier` fields accept
 *   `KnownCarrier | string` at the registry boundary — plugin adapters can
 *   register new carrier values without core PRs.
 * - The FE's tracking-URL map keys against `KnownCarrierValues`; unknown
 *   values gracefully degrade to copy-text-only.
 *
 * Adding a known carrier is a two-line edit: append here (core) + add an
 * entry to the FE's `CARRIER_TRACKING_URLS` map (apps/web). The FE helper's
 * unit test loops over `KnownCarrierValues`, forcing both sides to stay
 * aligned.
 */
export const KnownCarrierValues = [
  'inpost',
  'dpd',
  'dhl',
  'orlen',
  'allegro-one-box',
  'allegro-one-punkt',
  'allegro-one-kurier',
  'poczta-polska',
  'ups',
  'packeta',
] as const;

/**
 * Derived union type from `KnownCarrierValues`. Provides type safety without
 * runtime overhead — same pattern as `ShipmentStatusValues` / `ShipmentStatus`.
 */
export type KnownCarrier = (typeof KnownCarrierValues)[number];

export interface TrackingSnapshot {
  /** Canonical OL status. Adapter-mapped from the provider-native code. */
  status: ShipmentStatus;
  /** Time the courier picked up the parcel, if known. */
  dispatchedAt?: Date;
  /** Time the parcel was delivered, if known. */
  deliveredAt?: Date;
  /**
   * Carrier waybill / tracking number when the snapshot carries one (#838).
   * Carriers that issue tracking asynchronously (Allegro Delivery: after the
   * `/shipment-management` create-command completes) populate this on a later
   * poll; carriers that issue it synchronously at `generateLabel` (InPost) may
   * leave it `undefined` here — the status-sync service is the consumer that
   * backfills `Shipment.trackingNumber` when a new value appears.
   */
  trackingNumber?: string;
  /**
   * Actual carrier-of-record — the courier physically moving the parcel,
   * distinct from the dispatcher (#769). For InPost own-contract this is
   * always `'inpost'`; for Allegro Delivery brokered shipments the adapter
   * resolves the brokered carrier from `transportingInfo[].carrierId` and
   * normalises it to the canonical vocabulary ({@link KnownCarrier} via
   * {@link KnownCarrierValues}).
   *
   * **Typed `string` (open) at this extension boundary** — same precedent as
   * `AdapterMetadata.supportedCapabilities` (#576): plugin adapters can
   * register new carrier values without core PRs. The closed
   * {@link KnownCarrier} type is exported for FE consumers (the static
   * tracking-URL map) where exhaustiveness matters. JSDoc carries the
   * documentation; the type system reflects what the runtime actually accepts.
   *
   * Backfilled by `ShipmentStatusSyncService` onto `Shipment.carrier`
   * alongside `trackingNumber` — once written, never overwritten (cancel +
   * re-issue is the operator workflow if the carrier ever changes mid-flight).
   */
  carrier?: string;
  /** Provider-native status code, for diagnostics. Not used by core
   * branching logic. */
  providerStatus?: string;
}

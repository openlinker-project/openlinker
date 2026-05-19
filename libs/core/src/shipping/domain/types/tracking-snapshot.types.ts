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

export interface TrackingSnapshot {
  /** Canonical OL status. Adapter-mapped from the provider-native code. */
  status: ShipmentStatus;
  /** Time the courier picked up the parcel, if known. */
  dispatchedAt?: Date;
  /** Time the parcel was delivered, if known. */
  deliveredAt?: Date;
  /** Provider-native status code, for diagnostics. Not used by core
   * branching logic. */
  providerStatus?: string;
}

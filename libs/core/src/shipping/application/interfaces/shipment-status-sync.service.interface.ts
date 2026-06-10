/**
 * Shipment Status Sync Service Interface
 *
 * Read seam for the cursor-based shipment-status poll (#838). Polls each
 * non-terminal `Shipment` for one shipping-provider connection, advances the
 * `Shipment` row to reflect carrier reality, and propagates backfilled
 * tracking + status to the destination OMP via capability B
 * (`OrderFulfillmentUpdater`). Mirrors `IOfferStatusSyncService` (#816) so
 * the worker handler that drives it follows the same cursor-advance pattern.
 *
 * @module libs/core/src/shipping/application/interfaces
 */
import type {
  ShipmentStatusSyncOptions,
  ShipmentStatusSyncResult,
} from '../types/shipment-status-sync.types';

export interface IShipmentStatusSyncService {
  sync(
    connectionId: string,
    options: ShipmentStatusSyncOptions,
  ): Promise<ShipmentStatusSyncResult>;

  /**
   * Parcel-targeted refresh — the trigger half of the InPost webhook flow
   * (#768, ADR-021). Resolves the shipment by carrier `providerShipmentId`
   * (connection-scoped — a webhook on one connection must not refresh
   * another's), re-reads authoritative status via `getTracking`, and applies
   * the same per-shipment patch + OMP propagation the paged `sync()` does.
   * No-op (logged) when the parcel id resolves to no shipment or a shipment on
   * a different connection.
   */
  syncOneByProviderShipmentId(
    connectionId: string,
    providerShipmentId: string,
  ): Promise<void>;
}

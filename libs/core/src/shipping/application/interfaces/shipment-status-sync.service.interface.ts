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
}

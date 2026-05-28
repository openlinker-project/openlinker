/**
 * Fulfillment Status Sync Service Interface
 *
 * Application-layer contract for the branch-1 (OMP-fulfilled) shipment
 * status read-back service (#834). Injected via
 * `FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN`. The worker handler at
 * `apps/worker/src/.../handlers/marketplace-fulfillment-status-sync.handler.ts`
 * drives one `sync(connectionId, options)` call per tick, persists
 * `nextOffset` to `connection_cursors`, and reports the stats back to the
 * scheduler.
 *
 * @module libs/core/src/shipping/application/interfaces
 */

import type {
  FulfillmentStatusSyncOptions,
  FulfillmentStatusSyncResult,
} from '../types/fulfillment-status-sync.types';

export interface IFulfillmentStatusSyncService {
  sync(
    connectionId: string,
    options: FulfillmentStatusSyncOptions,
  ): Promise<FulfillmentStatusSyncResult>;
}

/**
 * Source Fulfillment Status Sync Service Interface
 *
 * Application-layer contract for the source-side fulfilment read-back: one
 * page of an order SOURCE's own view of its orders' fulfilment, recorded as
 * source-observed `Shipment` rows and relayed to the orders' destinations.
 * Injected via `SOURCE_FULFILLMENT_STATUS_SYNC_SERVICE_TOKEN`; the worker's
 * `marketplace.sourceFulfillment.statusSync` handler drives one `sync` call per
 * tick and persists `nextOffset` to `connection_cursors`.
 *
 * @module libs/core/src/shipping/application/interfaces
 * @see {@link IFulfillmentStatusSyncService} for the destination-side twin
 */

import type {
  SourceFulfillmentStatusSyncOptions,
  SourceFulfillmentStatusSyncResult,
} from '../types/source-fulfillment-status-sync.types';

export interface ISourceFulfillmentStatusSyncService {
  /**
   * Scan one page of the `ready`, not-cancelled orders ingested from
   * `connectionId` (the SOURCE connection) and record any waybill the source
   * reports that OpenLinker does not already know.
   */
  sync(
    connectionId: string,
    options: SourceFulfillmentStatusSyncOptions,
  ): Promise<SourceFulfillmentStatusSyncResult>;
}

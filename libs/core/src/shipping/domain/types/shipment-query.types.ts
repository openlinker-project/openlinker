/**
 * Shipment Query Types
 *
 * Filter + pagination + paginated-result contracts for the shipment read
 * surface (#846). Consumed by `ShipmentRepositoryPort.findMany` (domain) and
 * the `IShipmentQueryService` read seam (application). Mirrors the sync
 * context's `SyncJobFilters` / `SyncJobPagination` / `PaginatedSyncJobs`
 * shape so the `/shipments` read API matches the `/sync/jobs` precedent.
 *
 * @module libs/core/src/shipping/domain/types
 */

import type { Shipment } from '../entities/shipment.entity';
import type { ShipmentStatus } from './shipment-status.types';
import type { ShippingMethod } from './shipping-method.types';

export interface ShipmentFilters {
  /** Internal order id (`ol_order_*`). */
  orderId?: string;
  status?: ShipmentStatus;
  /**
   * Multi-status IN filter (#838). Takes precedence over `status` when both
   * are set. Lets the status-sync scan exclude terminal rows at the DB layer
   * (e.g. `['generated','dispatched','in-transit']`) — keep the explicit set,
   * not "non-terminal", so a future status addition is a deliberate edit.
   */
  statuses?: readonly ShipmentStatus[];
  /** Shipping-provider connection id (UUID). */
  connectionId?: string;
  shippingMethod?: ShippingMethod;
  /** `true` → only shipments with a tracking number; `false` → only those without. */
  hasTracking?: boolean;
  /**
   * Branch discriminator at the row level (#834). `true` → only rows with a
   * provider-issued id (branches 2/3); `false` → only branch-1 projection
   * rows (no provider id). Used by the branch-1 sync service's find-existing
   * lookup and by any future read API that wants to filter by branch.
   */
  hasProviderShipmentId?: boolean;
  /** Inclusive lower bound on `createdAt`. */
  createdFrom?: Date;
  /** Inclusive upper bound on `createdAt`. */
  createdTo?: Date;
}

export interface ShipmentPagination {
  limit: number;
  offset: number;
}

export interface PaginatedShipments {
  items: readonly Shipment[];
  /** Total rows matching the filters, ignoring pagination. */
  total: number;
}

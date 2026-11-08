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
import type { ShipmentDirection } from './shipment-direction.types';
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
  /**
   * Direction discriminator (#2373). **Optional here, unlike the required
   * argument on `findByOrderId` / `findActiveByOrderId` /
   * `findBranchOneByOrderAndConnection`** — and the asymmetry is deliberate.
   * Those three serve internal flows where an unstated cohort is a silent
   * decline; `findMany` also backs the operator-facing `GET /shipments` list,
   * where hard-filtering to outbound would make return labels permanently
   * invisible with no signal. So the operator can filter by direction and see
   * it on every row, while the status-sync scan passes `'outbound'`
   * explicitly rather than inheriting it.
   */
  direction?: ShipmentDirection;
  /** Shipping-provider connection id (UUID). */
  connectionId?: string;
  shippingMethod?: ShippingMethod;
  /** `true` → only shipments with a tracking number; `false` → only those without. */
  hasTracking?: boolean;
  /**
   * Exact tracking-number match (#3528) — backs the `/orders` search bar's
   * "find by waybill number" path. `undefined` here (unlike an empty string)
   * means "don't filter"; an empty string is not a valid tracking number and
   * the caller is expected not to pass one.
   */
  trackingNumber?: string;
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
  /**
   * Inclusive lower bound on `waybillRelayFailureCount` (#2073) — the
   * needs-attention bucket for a relay that keeps failing.
   *
   * A NUMBER, deliberately, and never a `waybillRelayStuck` boolean. Which
   * number means "stuck" is policy that lives in exactly one place
   * (`resolveWaybillRelayAlertThreshold`), resolved once at the HTTP boundary
   * and passed down; the repository has no business reading an environment
   * variable, and a boolean here would give the threshold a second reader that
   * could disagree with the one the operator's badge was rendered from.
   */
  waybillRelayFailureCountAtLeast?: number;
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

/**
 * One shared cause among failed shipments (#4043): the same connection and the
 * same exact provider code, or - when the code is coarse or absent - the same
 * code plus the same normalised carrier message. `sampleReason` is one
 * member's raw message, for display; the caller redacts it for a viewer.
 */
export interface ShipmentFailedCauseGroup {
  connectionId: string;
  /** Internal grouping key; not meant for display. */
  cause: string;
  providerCode: string | null;
  sampleReason: string;
  count: number;
}

/**
 * The shipments list's counts (#4043). Each axis is counted with every other
 * filter applied and its own axis removed (the orders summary rule), so a tab
 * or option shows what choosing it would return.
 */
export interface ShipmentSummary {
  /** Every shipment matching the filters, status removed. */
  total: number;
  byStatus: Record<ShipmentStatus, number>;
  byProcessor: { omp: number; carrier: number };
  byMethod: Record<ShippingMethod, number>;
  /** Count per shipping-provider connection id, connection filter removed. */
  byConnection: Record<string, number>;
  /** Shipments whose tracking never reached the channel (relay failing past the alert threshold). */
  waybillRelayStuck: number;
  /** Labels still to buy: drafts and generated shipments that are not marketplace-fulfilled. */
  toSend: number;
  /** Up to five shared causes among failed shipments, across all pages, largest first. */
  failedCauseGroups: ShipmentFailedCauseGroup[];
}

export interface ShipmentSummaryOptions {
  /** Failure count at which a waybill relay counts as stuck (resolved at the HTTP boundary). */
  waybillRelayStuckFloor: number;
}

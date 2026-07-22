/**
 * Orders Feature Types
 *
 * Frontend transport types for the orders API. Mirrors the backend
 * OrderRecordResponseDto and OrderSyncStatusResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/orders/api
 */

export const OrderSyncStatusValues = ['pending', 'syncing', 'synced', 'failed'] as const;
export type OrderSyncStatusValue = (typeof OrderSyncStatusValues)[number];

export interface OrderSyncStatus {
  destinationConnectionId: string;
  status: OrderSyncStatusValue;
  syncedAt: string | null;
  externalOrderId: string | null;
  externalOrderNumber: string | null;
  error: string | null;
}

/**
 * Per-destination append-only attempt entry. Mirrors `SyncAttemptResponseDto`
 * (BE) and `SyncAttempt` (CORE). The activity timeline renders one row per
 * attempt to preserve failure → retry → success history (#456).
 */
export interface SyncAttempt {
  destinationConnectionId: string;
  status: OrderSyncStatusValue;
  attemptedAt: string;
  error: string | null;
  externalOrderId: string | null;
  externalOrderNumber: string | null;
}

/**
 * Hand-mirrored from `SYNC_ATTEMPTS_PER_DESTINATION_CAP` in
 * `libs/core/src/orders/domain/types/order-sync.types.ts` per the FE-001
 * contract strategy. Used to decide whether to surface the "view all
 * attempts" deep link below a destination's group of timeline rows.
 * Keep in sync with the BE constant if the cap is ever tuned.
 */
export const SYNC_ATTEMPTS_PER_DESTINATION_CAP = 20;

// Mirrors the backend `OrderRecordStatusValues` in `@openlinker/core/orders`.
// Hand-written transport type per FE-001 contract strategy — keep in sync with backend.
export const OrderRecordStatusValues = ['ready', 'awaiting_mapping'] as const;
export type OrderRecordStatusValue = (typeof OrderRecordStatusValues)[number];

// Per-order fulfillment rollup (#1108). Hand-mirrored from
// `FulfillmentRollupStateValues` in `@openlinker/core/orders`. Shares spelling
// with the FE `FulfillmentState` (lib/order-health.ts) minus the FE-only
// `unavailable` render state (capability absent), which the BE never sends.
export const FulfillmentRollupStateValues = [
  'not-shipped',
  'dispatched',
  'delivered',
  'failed',
] as const;
export type FulfillmentRollupStateValue = (typeof FulfillmentRollupStateValues)[number];

// Ship-by SLA bucket (#1108). Hand-mirrored from `SlaStateValues` in
// `@openlinker/core/orders`. BE-owned (single source of truth): the FE consumes
// `slaState` and only renders the live countdown from `dispatchByAt`.
export const SlaStateValues = ['none', 'on_track', 'at_risk', 'overdue'] as const;
export type SlaStateValue = (typeof SlaStateValues)[number];

export interface OrderRecord {
  internalOrderId: string;
  customerId: string | null;
  sourceConnectionId: string;
  sourceEventId: string | null;
  orderSnapshot: Record<string, unknown>;
  syncStatus: OrderSyncStatus[];
  syncAttempts: SyncAttempt[];
  recordStatus: OrderRecordStatusValue;
  createdAt: string;
  updatedAt: string;
  /**
   * Marketplace dispatch (ship-by) deadline (ISO 8601) or null (#927). Surfaced
   * top-level by the BE (derived from the source dispatch window) so the list
   * SLA column / sort / filter and the detail countdown read it without parsing
   * the snapshot. Optional on the FE contract (mirrors the BE
   * `@ApiPropertyOptional`) so older/absent payloads degrade gracefully.
   */
  dispatchByAt?: string | null;
  /**
   * True when `dispatchByAt` is an OL-side ESTIMATE rather than a
   * marketplace-authoritative commitment (#1776). Erli derives its ship-by from
   * per-offer (falling back to connection-default) handling time and marks it
   * estimated; Allegro leaves it false/absent. The list + detail render a subtle
   * "~" qualifier next to the ship-by badge when true. Optional for graceful
   * degradation on older payloads.
   */
  dispatchByEstimated?: boolean;
  /**
   * Per-order fulfillment rollup (#1108). Optional on the FE contract so
   * older/absent payloads degrade gracefully (treated as `not-shipped`).
   */
  fulfillmentState?: FulfillmentRollupStateValue;
  /**
   * BE-owned ship-by SLA bucket (#1108). The list badge + filter both read this
   * (single source of truth); the FE only computes the live countdown from
   * `dispatchByAt`. Optional for graceful degradation.
   */
  slaState?: SlaStateValue;
}

// Result ordering for the orders list (#927, extended #944). Mirrors
// `OrderRecordSortValues` in `@openlinker/core/orders`. `dispatchBy` = ship-by
// ascending (triage default); `customer`/`items`/`status`/`total` back the
// sortable table columns (server-side).
export const OrderSortValues = [
  'createdAt',
  'dispatchBy',
  'customer',
  'items',
  'status',
  'total',
  'fulfillment',
  'payment',
] as const;
export type OrderSortValue = (typeof OrderSortValues)[number];

// Sort direction (#944). Mirrors `OrderRecordSortDirectionValues` in core.
export const OrderSortDirectionValues = ['asc', 'desc'] as const;
export type OrderSortDirection = (typeof OrderSortDirectionValues)[number];

// Derived order-health buckets (#929). Hand-mirrored from `OrderHealthValues`
// in `@openlinker/core/orders` per the FE-001 contract strategy — keep in sync.
// Partition the order set: every record maps to exactly one bucket, so the KPI
// segment counts sum to the total. Canonical precedence (highest wins) lives in
// `deriveOrderHealth` (lib/order-health.ts), the single FE source of truth.
export const OrderHealthValues = [
  'awaiting_mapping',
  'needs_attention',
  'synced',
  'awaiting_dispatch',
] as const;
export type OrderHealthValue = (typeof OrderHealthValues)[number];

/**
 * Per-health-bucket counts from `GET /orders/status-summary` (#929). Mirrors
 * `OrderHealthSummaryResponseDto` (BE). `total` equals the sum of the buckets.
 */
export interface OrderHealthSummary {
  total: number;
  awaitingMapping: number;
  needsAttention: number;
  synced: number;
  awaitingDispatch: number;
}

export interface OrderFilters {
  sourceConnectionId?: string;
  syncStatus?: OrderSyncStatusValue;
  customerId?: string;
  createdFrom?: string;
  createdTo?: string;
  recordStatus?: OrderRecordStatusValue;
  /** Filter to a single derived health bucket (#929). */
  health?: OrderHealthValue;
  /** Result ordering (#927/#944); `dispatchBy` = ship-by ascending (triage default). */
  sort?: OrderSortValue;
  /** Sort direction for `sort` (#944); defaults per-column server-side when omitted. */
  dir?: OrderSortDirection;
  /** SLA "breaching / overdue" filter (#927): ISO instant; keeps orders with a ship-by deadline ≤ this. */
  dueBefore?: string;
  /** Ship-by SLA bucket filter (#1108). */
  slaState?: SlaStateValue;
  /** Fulfillment-rollup filter (#1108). */
  fulfillmentState?: FulfillmentRollupStateValue;
}

/**
 * Per-SLA-bucket counts from `GET /orders/sla-summary` (#1108). Mirrors
 * `OrderSlaSummaryResponseDto` (BE). `total` equals the sum of the buckets.
 */
export interface OrderSlaSummary {
  total: number;
  onTrack: number;
  atRisk: number;
  overdue: number;
  none: number;
}

/**
 * Scope filters for the health-summary count (#929) — source/customer/date
 * subset only. Intentionally excludes `health` so the aggregate can't be
 * self-filtered. Mirrors `OrderHealthSummaryQueryDto` (BE).
 */
export interface OrderHealthSummaryFilters {
  sourceConnectionId?: string;
  customerId?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface OrderPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedOrders {
  items: OrderRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface RetryOrderDestinationResult {
  internalOrderId: string;
  destinationConnectionId: string;
  jobId: string;
  jobType: string;
}

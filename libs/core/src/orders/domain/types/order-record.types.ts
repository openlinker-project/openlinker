/**
 * Order Record Types
 *
 * Type definitions for order record read operations. Defines filters,
 * pagination, and paginated result types for querying order records.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { OrderRecord } from '../entities/order-record.entity';

/**
 * Sync status filter values for order queries
 */
export const OrderSyncStatusFilterValues = ['pending', 'syncing', 'synced', 'failed'] as const;

/**
 * Sync status filter type
 */
export type OrderSyncStatusFilter = (typeof OrderSyncStatusFilterValues)[number];

/**
 * Record status values — tracks whether all item refs have been resolved
 */
export const OrderRecordStatusValues = ['ready', 'awaiting_mapping'] as const;

/**
 * Record status type
 */
export type OrderRecordStatus = (typeof OrderRecordStatusValues)[number];

/**
 * Derived order-health buckets (#929).
 *
 * A single operator-facing classification reconciling `recordStatus` with the
 * per-destination `syncStatus[]`. The four buckets **partition** the order set
 * (every record maps to exactly one) so the list KPI cards sum to the total —
 * fixing the prior bug where empty-`syncStatus[]` and `awaiting_mapping` orders
 * fell into no bucket.
 *
 * CANONICAL PRECEDENCE (highest wins) — this comment is the single source of
 * truth; the FE `deriveOrderHealth` helper and the SQL in
 * `OrderRecordRepository.countByHealth` / `applyHealthFilter` must both encode
 * exactly this order:
 *   1. `awaiting_mapping`  — `recordStatus = 'awaiting_mapping'` (can't sync yet)
 *   2. `needs_attention`   — not awaiting_mapping AND any destination `failed`
 *   3. `synced`            — not awaiting_mapping, no failed, AND any `synced`
 *   4. `awaiting_dispatch` — the residual: everything else (no failed, no
 *                            synced: empty `syncStatus[]` / pending / syncing)
 *
 * Buckets 2–4 gate on `NOT awaiting_mapping` (not `recordStatus = 'ready'`) so
 * the four remain a complete partition for ANY `recordStatus` value — a future
 * status can't silently leave rows uncounted and break the cards' sum-to-total.
 */
export const OrderHealthValues = [
  'awaiting_mapping',
  'needs_attention',
  'synced',
  'awaiting_dispatch',
] as const;

/**
 * Derived order-health type
 */
export type OrderHealth = (typeof OrderHealthValues)[number];

/**
 * Aggregate count of order records per derived health bucket (#929).
 * `total` equals the sum of the four buckets for the same filter scope.
 */
export interface OrderHealthSummary {
  total: number;
  awaitingMapping: number;
  needsAttention: number;
  synced: number;
  awaitingDispatch: number;
}

/**
 * Filter scope for the health-summary count (#929). A deliberate subset of
 * `OrderRecordFilters` — it intentionally omits `health` (and the sync-status /
 * destination JSONB filters) so the aggregate can't be self-filtered into a
 * contradiction (counting all buckets while filtering to one).
 */
export interface OrderHealthSummaryFilters {
  sourceConnectionId?: string;
  customerId?: string;
  createdFrom?: Date;
  createdTo?: Date;
}

/**
 * Order record filters for list queries
 */
export interface OrderRecordFilters {
  sourceConnectionId?: string;
  syncStatus?: OrderSyncStatusFilter;
  customerId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  recordStatus?: OrderRecordStatus;
  /**
   * Filter to a single derived health bucket (#929). Translated to a SQL
   * predicate by `OrderRecordRepository.applyHealthFilter` using the canonical
   * precedence documented on {@link OrderHealthValues}. Used by the list page's
   * clickable status segments.
   */
  health?: OrderHealth;
  /**
   * Match records whose `syncStatus[]` contains an entry for this destination
   * connection (#834). JSONB containment — same idiom as the existing
   * `syncStatus` enum filter. Consumed by the shipping context's branch-1
   * status-sync service to enumerate "OL Orders mirrored to this destination".
   */
  destinationConnectionId?: string;
  /**
   * Inclusive lower bound on `updatedAt` (#834). Bounds the branch-1 scan
   * window — records that haven't been re-touched in `updatedSince` aren't
   * worth re-checking the destination OMP for. Note: `updatedAt` shifts on
   * every `updateSyncStatus` call, so a record that re-syncs stays in the
   * window even if it's been around for months.
   */
  updatedSince?: Date;
  /**
   * Dispatch-SLA "breaching / overdue" filter (#927): keep only records with a
   * known ship-by deadline at or before this instant (`dispatchByAt IS NOT NULL
   * AND dispatchByAt <= dueBefore`). The list passes `now` (overdue) or
   * `now + window` (breaching soon); records without a deadline are excluded.
   */
  dueBefore?: Date;
  /**
   * Result ordering (#927/#944). Maps to a SQL `ORDER BY` by
   * `OrderRecordRepository.applySort`. `dispatchBy` (ship-by deadline, NULLs
   * last) is the list's triage default; the JSONB-derived keys (`customer`,
   * `items`, `status`, `total`) back the clickable sortable columns (#944).
   */
  sort?: OrderRecordSort;
  /**
   * Sort direction for `sort` (#944). Defaults per-key in `applySort` when
   * absent (the FE supplies an explicit direction once a header is clicked).
   */
  dir?: OrderRecordSortDirection;
}

/**
 * Sort fields for order-record list queries (#927, extended #944).
 *
 * - `createdAt` / `dispatchBy` — top-level timestamp columns.
 * - `customer` / `items` / `status` / `total` — derived from `orderSnapshot`
 *   JSONB (and the health `CASE` for `status`); back the sortable table columns.
 */
export const OrderRecordSortValues = [
  'createdAt',
  'dispatchBy',
  'customer',
  'items',
  'status',
  'total',
] as const;
export type OrderRecordSort = (typeof OrderRecordSortValues)[number];

/**
 * Sort direction for order-record list queries (#944).
 */
export const OrderRecordSortDirectionValues = ['asc', 'desc'] as const;
export type OrderRecordSortDirection = (typeof OrderRecordSortDirectionValues)[number];

/**
 * Pagination parameters for order record queries.
 */
export interface OrderRecordPagination {
  limit: number;
  offset: number;
}

/**
 * Paginated order records result
 */
export interface PaginatedOrderRecords {
  items: OrderRecord[];
  total: number;
}

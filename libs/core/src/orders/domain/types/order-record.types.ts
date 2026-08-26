/**
 * Order Record Types
 *
 * Type definitions for order record read operations. Defines filters,
 * pagination, and paginated result types for querying order records.
 *
 * @module libs/core/src/orders/domain/types
 */
import type { OrderRecord } from '../entities/order-record.entity';
import type { SlaState } from './order-sla.types';
import type { FulfillmentRollupState } from './order-fulfillment.types';
import type { OrderLifecyclePhase } from '@openlinker/core/order-lifecycle';

/**
 * Per-destination sync status values (#2284).
 *
 * The single source of truth for the vocabulary: the persisted jsonb payload
 * (`OrderSyncStatus` / `SyncAttempt`, `OrderSyncStatusJson` / `SyncAttemptJson`),
 * the `/orders` query filter, and the response DTO all type off this one const —
 * so the persisted set and the queryable set can never drift.
 *
 * `'skipped_cancelled'` (#2284) is **terminal**: the source cancelled the order
 * before any destination order existed, so provisioning was deliberately
 * withheld. It is never retried (`OrderDestinationRetryService` retries only
 * `'failed'`) and must never read as a failure — nothing went wrong. Two
 * consequences of typing the query filter off the same const, both intended:
 * the response DTO widens with no edit, and `GET /orders?syncStatus=…`
 * legitimately accepts the new value.
 *
 * Health partitioning is deliberately unchanged: a cancelled-and-skipped order
 * falls into the residual `awaiting_dispatch` bucket. A dedicated bucket needs
 * the SQL twin plus the FE KPI cards and is out of scope for #2284.
 */
export const OrderSyncStatusFilterValues = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'skipped_cancelled',
] as const;

/**
 * Sync status filter type
 */
export type OrderSyncStatusFilter = (typeof OrderSyncStatusFilterValues)[number];

/**
 * Record status values — tracks whether all item refs have been resolved.
 *
 * `'source_deleted'` (#1689): at least one item ref failed resolution because
 * the mapped variant is `isStale` — deleted at its master (#1599). Distinct
 * from `'awaiting_mapping'` (an ordinary "not synced yet" gap that resolves
 * itself once the mapping lands): a deleted source item never resolves on its
 * own.
 */
export const OrderRecordStatusValues = ['ready', 'awaiting_mapping', 'source_deleted'] as const;

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
 *   1. `source_deleted`   — `recordStatus = 'source_deleted'` (permanently
 *                            unresolvable — the source item was deleted at
 *                            its master, #1689)
 *   2. `awaiting_mapping`  — `recordStatus = 'awaiting_mapping'` (can't sync yet)
 *   3. `needs_attention`   — not awaiting_mapping/source_deleted AND any destination `failed`
 *   4. `synced`            — not awaiting_mapping/source_deleted, no failed, AND any `synced`
 *   5. `awaiting_dispatch` — the residual: everything else (no failed, no
 *                            synced: empty `syncStatus[]` / pending / syncing)
 *
 * Buckets 3–5 gate on `NOT awaiting_mapping AND NOT source_deleted` (not
 * `recordStatus = 'ready'`) so the five remain a complete partition for ANY
 * `recordStatus` value — a future status can't silently leave rows uncounted
 * and break the cards' sum-to-total.
 */
export const OrderHealthValues = [
  'source_deleted',
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
  sourceDeleted: number;
  awaitingMapping: number;
  needsAttention: number;
  synced: number;
  awaitingDispatch: number;
  /**
   * Orders with a persisted sales-document block (#2100). ORTHOGONAL to the five
   * buckets above and DELIBERATELY NOT part of the partition: an invoicing block
   * says nothing about sync health, so a blocked order is also counted in exactly
   * one of the five (it is typically `synced`). `total` therefore still equals the
   * sum of the FIVE buckets, and this count must never be added to them.
   *
   * It rides on this summary rather than a sixth `OrderHealth` value because
   * `deriveOrderHealth` returns exactly one bucket per order and its SQL twins
   * partition the set — a sixth value would either double-count or hide a sync
   * failure behind an invoicing one.
   */
  salesDocumentBlocked: number;
  /**
   * Orders where the shop and the channel named DIFFERENT tax rates (#2254).
   *
   * Its OWN count, not part of `salesDocumentBlocked`. A conflict does not stop
   * the invoice, so an order can be in conflict and perfectly healthy - and
   * folding it into the blocked count would print one number twice on the same
   * screen while making its badge unreachable (epic F1).
   */
  taxRateConflict: number;
  /**
   * Orders carrying at least one COUNTED OMS inert state (#2352/#2353).
   *
   * A THIRD orthogonal axis, beside `salesDocumentBlocked` and
   * `taxRateConflict` and never inside either: an order can be invoicing-blocked
   * AND short on stock, and printing one number under two labels is exactly what
   * the separate fields avoid. Like both of those it deliberately carries no
   * `notMappingOrDeleted` guard, so it is counted here AND in whichever health
   * bucket the order belongs to - `total` still equals the sum of the five
   * buckets.
   *
   * The ORDER half only. Return-scoped states (RB-L, OR-P) are counted on the
   * returns side; a surface wanting both adds them.
   */
  omsAttention: number;
  /**
   * When the OLDEST still-held order was held (#2254), or `null` when nothing
   * is held. Lets the blocked chip carry an age inside its label rather than
   * adding a third dotted badge to a row that already has two SLA badges.
   */
  salesDocumentBlockedOldestAt: Date | null;
}

/**
 * "Value stuck in failed syncs" — the needs-attention aggregate (#1983) over
 * the same `HAS_FAILED` bucket `countByHealth` already partitions on. Reports
 * both the count and the summed order value so an operator can judge urgency
 * by money, not just by ticket count. `mixedCurrency` is `true` when the
 * failed orders span more than one currency — the sum is currency-naive in
 * that case, and the caller should say so rather than presenting a single
 * misleadingly-precise total.
 */
export interface FailedSyncValueSummary {
  count: number;
  totalValue: number;
  mixedCurrency: boolean;
  oldestFailedAt: Date | null;
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
  /**
   * Cancellation scope (#2306). The summary twin of `OrderRecordFilters.cancelled`
   * — omitted means unscoped (byte-identical to pre-#2306 behaviour), `false`
   * means `cancelledAt IS NULL`, `true` means `cancelledAt IS NOT NULL`.
   *
   * Honoured by `countBySla` ONLY. A cancelled order that never shipped still
   * satisfies the `NOT_SHIPPED` guard, so without this scope its past deadline
   * counts as `overdue` — the dispatch-risk surface passes `cancelled: false` to
   * both the list read and this summary so rows and counts agree by construction.
   * `countByHealth` deliberately ignores it: health is an orthogonal axis and
   * silently re-scoping it would move numbers on surfaces not in scope here.
   */
  cancelled?: boolean;
}

/**
 * Aggregate count of order records per derived lifecycle phase (#2309,
 * ADR-059). One field per `OrderLifecyclePhaseValues` member, in that
 * vocabulary's own precedence order.
 *
 * **`total` equals the sum of the nine buckets, by construction** — unlike
 * `OrderHealthSummary`, whose bucket predicates are hand-composed, every bucket
 * here tests the SAME single `CASE` expression for equality with a different
 * phase, so no row can be counted twice or missed.
 *
 * **Three buckets are structurally zero in Wave 1a.** `vendor_authoritative`
 * has no producer until posture-B columns land (Wave 4), and `held` /
 * `amending` have no persisted source until Wave 2 — their SQL arms are
 * documented `FALSE` placeholders, so a count of 0 is a correct report about a
 * fact OL does not yet record, not a bug.
 *
 * Scope reuses `OrderHealthSummaryFilters`, whose `cancelled` arm this summary
 * deliberately IGNORES — see `countByLifecyclePhase`.
 */
export interface OrderLifecyclePhaseSummary {
  total: number;
  cancelled: number;
  vendorAuthoritative: number;
  delivered: number;
  inTransit: number;
  fulfillmentFailed: number;
  held: number;
  amending: number;
  blocked: number;
  ready: number;
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
   * Ship-by SLA bucket filter (#1108). Encodes the {@link SlaState} rule in SQL
   * (incl. the "cleared once shipped" guard via `fulfillmentState`), evaluated
   * against the repository's server `now`. Matches the badge the FE renders from
   * the response `slaState` (single source of truth).
   */
  slaState?: SlaState;
  /**
   * Fulfillment-rollup filter (#1108). NULL column ≡ `not-shipped`, so the
   * `not-shipped` filter also matches rows with no stored value.
   */
  fulfillmentState?: FulfillmentRollupState;
  /**
   * Cancellation filter (#1984). Maps directly to `cancelledAt IS [NOT] NULL`
   * — `true` keeps only cancelled orders, `false` excludes them. Queryable
   * without parsing `orderSnapshot`; not yet wired into any HTTP query param
   * or FE control — that is the aggregate endpoints' job (#1987/#1988).
   */
  cancelled?: boolean;
  /**
   * Sales-document block filter (#2100). `true` keeps only orders carrying an
   * ATTENTION-WORTHY block, `false` keeps only the rest; omitted does not filter.
   *
   * "Attention-worthy" is `SalesDocumentAttentionReasonValues`, i.e. every reason
   * EXCEPT `'trigger-model-manual'` — so `true` deliberately does **not** return
   * manual-only orders even though OpenLinker did decline to invoice them, and
   * `false` includes them. That is the same subset the `salesDocumentBlocked`
   * count reports, so the chip's number always matches the rows the filter yields;
   * a filter that returned more than its own count would be worse than one that
   * omits a deliberate operator setting. The per-order badge still renders manual.
   *
   * An INDEPENDENT axis, not an `OrderHealth` value: a blocked order still sits
   * in exactly one health bucket, so this filter composes with `health` rather
   * than competing with it (an operator can ask for "synced AND invoicing
   * blocked", which is the most common shape of the problem).
   */
  salesDocumentBlocked?: boolean;
  /**
   * Derived lifecycle-phase filter (#2309, ADR-059). Translated to a SQL
   * predicate by `OrderRecordRepository.applyLifecyclePhaseFilter`, which tests
   * the ONE `CASE` expression the phase count also tests — so the chip's number
   * and the rows it yields agree by construction.
   *
   * The SQL is the **twin** of the pure `deriveOrderLifecyclePhase` (#2307),
   * which stays authoritative per row and is what the response `lifecyclePhase`
   * carries. Unlike `slaState`, the phase is CLOCK-FREE (ADR-059), so the row
   * value and this filter can never disagree by milliseconds.
   *
   * A SECOND ORTHOGONAL PARTITION beside `health`, never a sixth health bucket
   * (the #2100 trap): a held order is usually also `synced`, so this filter
   * composes with `health` rather than competing with it.
   */
  lifecyclePhase?: OrderLifecyclePhase;
  /**
   * Restrict to orders where the shop and the channel named different tax rates
   * (#2254). `undefined` means "don't filter".
   *
   * A separate axis from `salesDocumentBlocked`, and it has to be: the rows it
   * finds are usually INVOICED, which is exactly why they are invisible in
   * every other view.
   */
  taxRateConflict?: boolean;
  /**
   * Restrict to orders carrying at least one COUNTED OMS inert state
   * (#2352/#2353). `undefined` means "don't filter"; both `true` and `false`
   * are meaningful predicates.
   *
   * **Not the `needs_attention` HEALTH bucket.** That bucket is a member of a
   * partition and means a sync failure; this is an orthogonal axis over the
   * `omsAttention` jsonb and means OpenLinker stopped deciding something. The
   * two populations overlap freely and neither implies the other - which is why
   * this is ANDed with `health` rather than folded into it (the #2100 trap).
   *
   * A reason this build does not recognise never matches, because the predicate
   * is an explicit list built from `AuthorityAttentionCountedReasonValues`
   * rather than "the column is not empty" (spec §4.4 S2-5).
   */
  omsAttention?: boolean;
  /**
   * Result ordering (#927/#944/#1108). Maps to a SQL `ORDER BY` by
   * `OrderRecordRepository.applySort`. `dispatchBy` (ship-by deadline, NULLs
   * last) is the list's triage default; the JSONB-derived keys (`customer`,
   * `items`, `status`, `total`) back the clickable sortable columns (#944);
   * `fulfillment` orders by the rollup ordinal (#1108).
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
 * - `customer` / `items` / `status` / `total` / `payment` — derived from
 *   `orderSnapshot` JSONB (and the health `CASE` for `status`); back the
 *   sortable table columns.
 */
export const OrderRecordSortValues = [
  'createdAt',
  'dispatchBy',
  'customer',
  'items',
  'status',
  'total',
  'fulfillment',
  'payment',
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

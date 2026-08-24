/**
 * Orders Feature Types
 *
 * Frontend transport types for the orders API. Mirrors the backend
 * OrderRecordResponseDto and OrderSyncStatusResponseDto contracts.
 * All date fields are ISO 8601 strings.
 *
 * @module apps/web/src/features/orders/api
 */
// #2441 review S10 — the types-only sibling, never `order-lifecycle-phase.ts`:
// that module imports `StatusBadgeTone`, which would have this wire-shape module
// transitively naming a component module.
import type { OrderLifecyclePhaseValue } from '../lib/order-lifecycle-phase.types';

/**
 * Mirrors CORE `OrderSyncStatusFilterValues` (`order-record.types.ts`).
 *
 * `'skipped_cancelled'` (#2284) is terminal and is NOT a failure: the source
 * cancelled the order before any destination order existed, so provisioning was
 * deliberately withheld. It must never borrow an error colour and is never
 * retryable.
 */
export const OrderSyncStatusValues = [
  'pending',
  'syncing',
  'synced',
  'failed',
  'skipped_cancelled',
] as const;
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
// `source_deleted` (#1689): the mapped variant was deleted at its master
// (#1599) — a permanently unresolvable item ref, distinct from the
// self-healing `awaiting_mapping` gap.
export const OrderRecordStatusValues = ['ready', 'awaiting_mapping', 'source_deleted'] as const;
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

// Why OpenLinker issued no sales document (invoice or fiscal receipt) for an
// order (#2100/#2156, ADR-041 decision 11). Hand-mirrored from
// `SalesDocumentGateBlockReasonValues` / `SalesDocumentUnresolvedReasonValues` in
// `@openlinker/core/sales-documents` per the FE-001 contract strategy (the
// browser bundle cannot import core).
//
// ENFORCED, not merely commented: `scripts/check-sales-document-reason-mirror.mjs`
// fails `pnpm check:invariants` on any drift in either direction. Drift here is
// silent both ways — a reason added only to core renders as an unlabelled badge,
// and one added only here type-checks against a value the API will never send.
export const SalesDocumentGateBlockReasonValues = [
  'unresolved-routing',
  'missing-required-tax-id',
  'tax-rate-conflict',
  'trigger-model-manual',
  'trigger-model-batched',
] as const;
export type SalesDocumentGateBlockReasonValue =
  (typeof SalesDocumentGateBlockReasonValues)[number];

export const SalesDocumentUnresolvedReasonValues = [
  'no-matching-rule',
  'conflicting-rules-equal-priority',
  'ambiguous-connection-no-primary',
  'unsupported-document-kind-on-connection',
  'net-priced-order',
  // #2170 rule-engine additions — see the backend file for the full rationale.
  'no-configuration-for-country',
  'threshold-currency-mismatch',
] as const;
export type SalesDocumentUnresolvedReasonValue =
  (typeof SalesDocumentUnresolvedReasonValues)[number];

// ── Mapping-aware delivery (epic #1776) ─────────────────────────────────────
// Hand-mirrored from the BE order response DTOs (`OrderDeliveryResolutionDto`
// #1791, `OrderDeliveryRiderDto` #1792) and the `@openlinker/core/mappings`
// unions, per the FE-001 contract strategy — keep in sync with the backend.

// How fulfillment routing resolved for the order's delivery method (#1791):
// `rule` = a configured routing rule matched; `default` = the omp_fulfilled
// fallback (shop-fulfilled). The rider only fires on a `default` resolution.
export const FulfillmentRoutingSourceValues = ['rule', 'default'] as const;
export type FulfillmentRoutingSource = (typeof FulfillmentRoutingSourceValues)[number];

// Where the fulfilling connection sits (#1791). Mirrors the `mappings` feature's
// `FulfillmentProcessorKind`; re-declared here so `orders` stays decoupled.
export const FulfillmentProcessorKindValues = [
  'omp_fulfilled',
  'ol_managed_carrier',
  'source_brokered',
] as const;
export type FulfillmentProcessorKind = (typeof FulfillmentProcessorKindValues)[number];

/** Read-only projection of how fulfillment routing resolved for an order (#1791). */
export interface OrderDeliveryResolution {
  source: FulfillmentRoutingSource;
  processorKind: FulfillmentProcessorKind;
  processorConnectionId: string | null;
  /**
   * Whether the resolved processor connection is currently usable (status
   * "active"). A rule to a disabled processor still matches but reports false
   * (#1799) so the FE never renders a dead route as a live carrier. Optional
   * for older/degraded payloads → treated as available.
   */
  processorAvailable?: boolean;
}

// Actionable delivery hint (#1792/#1799): `unmapped` (a supported carrier is
// connected → Add mapping), `not-connected` (OL supports the carrier but none is
// connected → Connect), `disabled` (a rule mapped the method to a disabled
// carrier connection → Enable), `none` (show nothing).
export const DeliveryRiderValues = ['unmapped', 'not-connected', 'disabled', 'none'] as const;
export type DeliveryRiderValue = (typeof DeliveryRiderValues)[number];

/** Heuristic-matched candidate carrier for an actionable rider (#1792). */
export interface DeliveryRiderCandidateCarrier {
  platformType: string;
  displayName: string;
}

/** Delivery rider projection (#1792) — present alongside the routing resolution. */
export interface OrderDeliveryRider {
  rider: DeliveryRiderValue;
  /** Present only for the actionable riders (`unmapped` / `not-connected` / `disabled`). */
  candidateCarrier?: DeliveryRiderCandidateCarrier;
}

// Source-side amendment kinds (#2283). Hand-mirrored from
// `OrderAmendmentChangeKindValues` in `@openlinker/core/orders` per the FE-001
// contract strategy — keep in sync.
export const OrderAmendmentChangeKindValues = [
  'line-removed',
  'line-added',
  'line-quantity-changed',
  'shipping-address-changed',
] as const;
export type OrderAmendmentChangeKindValue = (typeof OrderAmendmentChangeKindValues)[number];

/**
 * One observed source amendment. PII-free by backend contract: ids, SKUs and
 * quantities verbatim, and for an address change only the NAMES of the fields
 * that moved.
 */
export interface OrderAmendmentChange {
  kind: OrderAmendmentChangeKindValue;
  lineId?: string;
  sku?: string;
  fromQuantity?: number;
  toQuantity?: number;
  fields?: string[];
}

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
  /**
   * How fulfillment routing resolved for this order's delivery method (#1791).
   * Optional — older/absent payloads degrade to a snapshot-only chip.
   */
  deliveryResolution?: OrderDeliveryResolution;
  /**
   * Actionable delivery hint on a defaulted order (#1792). Present only
   * alongside a `default` resolution; `rider: 'none'` renders nothing.
   */
  deliveryRider?: OrderDeliveryRider;
  /** Source delivery-method id (#1791) — the #1794 Add-mapping deep-link target. */
  sourceDeliveryMethodId?: string | null;
  /** Source delivery-method label (#1791). */
  sourceDeliveryMethodName?: string | null;
  /**
   * Operator-facing reason item resolution failed at ingestion (#1689), set
   * alongside `recordStatus = 'awaiting_mapping' | 'source_deleted'`. `null`
   * for a `'ready'` record. Optional for graceful degradation on older payloads.
   */
  mappingFailureReason?: string | null;
  /**
   * Why OpenLinker issued no sales document for this order (#2100, #2156).
   * `null` when nothing is blocking it. Independent of `recordStatus` — an
   * order can be `ready` and `synced` while still carrying a block.
   */
  salesDocumentBlockReason?: SalesDocumentGateBlockReasonValue | null;
  /**
   * The routing reason paired with a `'unresolved-routing'` block (ADR-041
   * §107). This is what the operator-facing copy keys on: "routing was
   * unresolved" is not actionable, "no primary connection" is.
   */
  salesDocumentUnresolvedReason?: SalesDocumentUnresolvedReasonValue | null;
  /** PII-free elaboration of the block reason (ids and counts only). */
  salesDocumentBlockDetail?: string | null;
  /**
   * Instant OpenLinker last observed the SOURCE amend this order after it was
   * already ingested (#2283) — a line removed, added or re-quantified, or the
   * shipping address edited. `null`/absent = never observed amended. An internal
   * fact: it moves no status and gates nothing, so it is rendered as one more
   * timeline entry rather than a state.
   */
  lastAmendedAt?: string | null;
  /**
   * What changed at `lastAmendedAt` (#2283) — most recent observation only.
   * PII-free by contract: an address change names the FIELDS that moved and
   * never their values, so this is safe to render verbatim.
   */
  lastAmendmentChanges?: OrderAmendmentChange[] | null;
  /**
   * Instant an operator marked this order packed (#2287/#2288). `null`/absent =
   * not packed. A plain operator fact: it moves no status, gates nothing and is
   * owned by neither the source nor a destination — which is why the list shows
   * it as a tick rather than a badge, and the detail page (not the row) acts.
   * Optional for graceful degradation on a pre-#2287 payload.
   */
  packedAt?: string | null;
  /**
   * OL user id of whoever marked it packed (#2287). Moves as one group with
   * `packedAt`, so it is non-null exactly when `packedAt` is.
   */
  packedByUserId?: string | null;
  /**
   * The derived lifecycle phase (#2305/#2309) — "what is this order waiting on".
   * Derived server-side on every read; the FE never re-derives it. A SECOND
   * orthogonal partition beside the health bucket, never a sixth health value
   * (ADR-059). Optional for graceful degradation on a pre-#2309 payload, which
   * is the one case the phase badge renders nothing.
   */
  lifecyclePhase?: OrderLifecyclePhaseValue;
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
  'source_deleted',
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
  sourceDeleted: number;
  awaitingMapping: number;
  needsAttention: number;
  synced: number;
  awaitingDispatch: number;
  /**
   * Orders carrying a persisted sales-document block (#2100). ORTHOGONAL to the
   * buckets above — a blocked order is also counted in exactly one of them — so
   * this never joins the KPI segment row and must not be added to their sum.
   * Optional for graceful degradation against an older API.
   */
  salesDocumentBlocked?: number;
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
  /**
   * Sales-document block filter (#2100). An independent axis that composes with
   * `health` — "synced AND invoicing blocked" is the common shape of the problem.
   */
  salesDocumentBlocked?: boolean;
  /**
   * Cancellation filter (#2306): `false` excludes cancelled orders, `true` keeps
   * only them, omitted does not filter. The dispatch-risk page passes `false` so
   * its rows match the counts `slaSummary` returns under the same scope.
   */
  cancelled?: boolean;
  /**
   * Filter to a single derived lifecycle phase (#2310), `?phase=`. Composes with
   * `health` rather than replacing it — the two axes are orthogonal, so "synced
   * AND blocked" is a real and common shape.
   */
  phase?: OrderLifecyclePhaseValue;
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
  /**
   * Cancellation scope (#2306). Honoured by `GET /orders/sla-summary` only —
   * `status-summary` ignores it, since health is an orthogonal axis. Omitted
   * means unscoped; the dispatch-risk page passes `false` because a cancelled,
   * never-shipped order otherwise counts as `overdue`.
   */
  cancelled?: boolean;
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

/**
 * Per-lifecycle-phase counts from `GET /orders/lifecycle-summary` (#2309).
 * Mirrors `OrderLifecyclePhaseSummaryResponseDto` (BE), camelCase per phase.
 * The phases partition the set, so the nine buckets sum to `total`.
 *
 * `vendorAuthoritative`, `held` and `amending` are structurally 0 until Waves 2
 * and 4 supply their producers — a correct report about a fact OL does not yet
 * record, not a gap.
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

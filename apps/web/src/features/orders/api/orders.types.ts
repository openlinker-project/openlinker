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
  'missing-tax-rate',
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

// ── Sales-document view (#2516/#2552, ADR-065) ──────────────────────────────
// Hand-mirrored from `SalesDocumentView` (`@openlinker/core/sales-documents`)
// and `SalesDocumentViewResponseDto`
// (`apps/api/src/orders/http/dto/sales-document-view-response.dto.ts`), which
// `GET /orders` batches onto every row (`OrderRecord.salesDocument` below) so
// the money-cluster document line and its popover never issue a second
// request. This is the SAME projection the order-detail panel and the
// settings page's per-market evidence read (ADR-065) — one shape, three
// renderers.
//
// Two rules travel from the DTO's own doc comment; a surface that forgets
// them repeats a defect this epic has already shipped fixes for:
//
// 1. A fiscal receipt has no authority axis — `SalesDocumentReceiptView`
//    carries no regulatory field at all, a discriminated union on `kind`
//    rather than an optional field, so the missing axis is unrepresentable.
// 2. `blockReason` / `unresolvedReason` / `blockDetail` are the PERSISTED
//    reasons, verbatim — a surface renders the stored value through
//    `resolveSalesDocumentReasonCopy` or renders nothing.

/** Identity fields a surface renders for a document, whichever kind it is. */
export interface SalesDocumentIdentity {
  readonly recordId: string;
  readonly connectionId: string;
  /** `null` when the record exists but no provider has resolved onto it yet. */
  readonly providerType: string | null;
  /** `null` means no number has been assigned yet — never "this regime has none". */
  readonly documentNumber: string | null;
  readonly createdAt: string;
  /** `null` while the document is still pending, in flight, or failed. */
  readonly completedAt: string | null;
  /** `null` means no in-flight claim is held. */
  readonly inFlightUntil: string | null;
}

/** An invoice, on both its axes: issuance (`status`) and clearance (`regulatoryStatus`). */
export interface SalesDocumentInvoiceView {
  readonly kind: 'invoice';
  readonly documentType: string;
  readonly status: 'pending' | 'issued' | 'issuing' | 'failed';
  readonly failureMode: 'rejected' | 'in-doubt' | null;
  readonly failureCode: string | null;
  readonly failureReason: string | null;
  readonly regulatoryStatus:
    | 'not-applicable'
    | 'pending-submission'
    | 'submitted'
    | 'cleared'
    | 'accepted'
    | 'rejected';
  readonly clearanceReference: string | null;
  readonly identity: SalesDocumentIdentity;
}

/** A fiscal receipt, on its ONE axis — no clearance/authority field exists (ADR-042). */
export interface SalesDocumentReceiptView {
  readonly kind: 'fiscal-receipt';
  readonly status: 'pending' | 'registering' | 'registered' | 'failed';
  readonly failureMode: 'rejected' | 'in-doubt' | null;
  readonly failureReason: string | null;
  /** `0` on a `registered` row is a SUCCESS — a pure reporting regime returns no artefact. */
  readonly artefactCount: number;
  readonly identity: SalesDocumentIdentity;
}

export type SalesDocumentRecordView = SalesDocumentInvoiceView | SalesDocumentReceiptView;

/** A record held for the same order on ANOTHER connection — reported, never hidden. */
export interface SalesDocumentOtherRecord {
  readonly recordId: string;
  readonly connectionId: string;
  readonly kind: string;
  readonly blocksFurtherIssuance: boolean;
}

/** Everything a surface needs about one order's sales document (ADR-065). */
export interface SalesDocumentView {
  readonly orderId: string;
  /**
   * Open-world (unlike `document.kind`, which is closed on the two kinds this
   * projection knows how to render). `null` means routing has NOT decided —
   * never a fallback guess from the order's own country.
   */
  readonly documentKind: string | null;
  /** `null` when none exists yet — an ordinary state alongside a non-null `documentKind`. */
  readonly document: SalesDocumentRecordView | null;
  /** The PERSISTED gate reason, verbatim. `null` means no block on the gate's last run. */
  readonly blockReason: SalesDocumentGateBlockReasonValue | null;
  /** Non-null only alongside `blockReason === 'unresolved-routing'` (ADR-041 §107). */
  readonly unresolvedReason: SalesDocumentUnresolvedReasonValue | null;
  /** Free-text elaboration the gate stored; never parsed, only displayed. */
  readonly blockDetail: string | null;
  readonly otherRecords: readonly SalesDocumentOtherRecord[];
}

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
   * When the current sales-document hold started (ISO 8601), or null (#2248).
   * The only clock an operator-facing age can run on: the reason itself is
   * level-triggered and nulled the moment it clears.
   */
  salesDocumentBlockedAt?: string | null;
  /** When the current hold ended (ISO 8601), cleared when a new one starts. */
  salesDocumentBlockReleasedAt?: string | null;
  /**
   * The batched per-order sales-document projection (#2516/#2552, ADR-065).
   * Absent when the row predates this field or the batch read found nothing
   * to attach — a surface must render the same "no document" state it already
   * does for `documentKind: null`, never treat absence as an error.
   */
  salesDocument?: SalesDocumentView;
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
  /**
   * Orders where the shop and the channel named DIFFERENT tax rates (#2254).
   * Its OWN count, never inside `salesDocumentBlocked` — a conflict does not
   * stop the invoice, so an order can be in conflict and perfectly healthy.
   * Optional for graceful degradation against an older API.
   */
  taxRateConflict?: number;
  /**
   * When the oldest still-held order was held (ISO 8601), or `null`/absent when
   * nothing is held (#2254). The blocked chip folds an age into its own label
   * from this, rather than adding a third dotted badge to a row that already
   * carries two SLA badges.
   */
  salesDocumentBlockedOldestAt?: string | null;
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
   * Tax-rate conflict filter (#2254). A separate axis, and it has to be: the
   * rows it finds are usually already invoiced, which is exactly why they are
   * invisible in every other view.
   */
  taxRateConflict?: boolean;
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

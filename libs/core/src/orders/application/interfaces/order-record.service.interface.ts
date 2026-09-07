/**
 * Order Record Service Interface
 *
 * Defines the contract for order record persistence operations.
 * This interface specifies the methods needed for persisting order records
 * with PII-aware snapshot handling and sync status tracking.
 *
 * @module libs/core/src/orders/application/interfaces
 */
import type { Order } from '../../domain/types/order.types';
import type { OrderRecord, OrderSyncStatus } from '../../domain/entities/order-record.entity';
import type { IncomingOrder } from '../../domain/types/incoming-order.types';
import type {
  FailedSyncValueSummary,
  OrderHealthSummaryFilters,
  OrderRecordFilters,
  OrderRecordPagination,
  OrderRecordStatus,
  PaginatedOrderRecords,
} from '../../domain/types/order-record.types';
import type { FulfillmentRollupState } from '../../domain/types/order-fulfillment.types';
import type { FulfillmentBlock } from '@openlinker/core/fulfillment';
import type {
  SalesDocumentBlock,
  SalesDocumentMarketDiscovery,
} from '@openlinker/core/sales-documents';
import type { OrderAmendmentChange } from '../../domain/order-amendment-diff';
import type {
  SalesAnalyticsFilters,
  SalesAndChannelAnalytics,
} from '../../domain/types/order-sales-analytics.types';
import type {
  TopProductFilters,
  TopProductsResult,
  VariantSalesResult,
} from '../../domain/types/top-products.types';
import type {
  CoverageDetectionPagination,
  PaginatedCurrencyMismatchOrders,
  PaginatedProductMatchingErrorOrders,
  CoverageConnectionAggregateRow,
} from '../../domain/types/coverage-detection.types';

export interface IOrderRecordService {
  /**
   * Persist order record with PII-aware snapshot
   *
   * Creates a snapshot of the order that respects OL_STORE_PII configuration.
   * If PII storage is disabled, sensitive fields (email, names, addresses) are
   * nulled out in the snapshot.
   *
   * @param order - Unified order with internal IDs
   * @param sourceConnectionId - Source connection ID (where order originated)
   * @param sourceEventId - Optional source event ID
   * @param sourceExternalUrl - Optional deep link to the order in the source
   *   platform's UI (#1713), built by the source adapter; persisted onto the
   *   snapshot as `sourceExternalUrl`.
   * @returns Persisted order record
   */
  persistOrder(
    order: Order,
    sourceConnectionId: string,
    sourceEventId: string | null,
    sourceExternalUrl?: string | null
  ): Promise<OrderRecord>;

  /**
   * Update sync status for a destination
   *
   * Updates the sync status for a specific destination connection after
   * order sync completes (successfully or with error).
   *
   * @param internalOrderId - Internal order ID
   * @param destinationConnectionId - Destination connection ID
   * @param status - Sync status
   */
  updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus
  ): Promise<void>;

  /**
   * Persist raw incoming snapshot before item resolution.
   *
   * Called immediately after ID resolution but before offer→variant mapping.
   * Sets recordStatus='awaiting_mapping'. On retry, once all items resolve,
   * persistOrder() upserts with recordStatus='ready'.
   *
   * The orderSnapshot stores the raw IncomingOrder — items retain external offer
   * refs and do NOT contain internal product/variant IDs.
   */
  persistIncomingSnapshot(
    incoming: IncomingOrder,
    internalOrderId: string,
    customerId: string | null,
    sourceConnectionId: string,
    sourceEventId: string | null
  ): Promise<OrderRecord>;

  /**
   * Get order record by ID
   *
   * Retrieves a persisted order record for retry/debug purposes.
   *
   * @param internalOrderId - Internal order ID
   * @returns Order record or null if not found
   */
  getOrderRecord(internalOrderId: string): Promise<OrderRecord | null>;

  /**
   * Filtered, paginated list of order records (#834). The cross-context
   * surface the shipping branch-1 sync service uses to enumerate
   * destination-matched records — repository ports are forbidden across
   * context boundaries per architecture-overview.md § "Cross-context
   * dependencies in core", so callers go through this service method
   * instead. Delegates to `OrderRecordRepositoryPort.findMany`.
   */
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords>;

  /**
   * Batch-find order records by internal order ID (#1995). The cross-context
   * surface for a page-scoped join (e.g. the Shipments/Invoices lists'
   * `orderSummary` projection) — repository ports are forbidden across context
   * boundaries per architecture-overview.md § "Cross-context dependencies in
   * core", so callers go through this service method instead of
   * `OrderRecordRepositoryPort.findByIds` directly. Ids with no matching
   * record are simply absent from the result. Delegates to
   * `OrderRecordRepositoryPort.findByIds`.
   */
  findByIds(internalOrderIds: string[]): Promise<OrderRecord[]>;

  /**
   * Batch earliest-order-date lookup by source connection (#2083). The
   * cross-context surface `analytics-trust`'s coverage-window read uses —
   * repository ports are forbidden across context boundaries per
   * architecture-overview.md § "Cross-context dependencies in core", so
   * callers go through this service method instead of
   * `OrderRecordRepositoryPort.findEarliestOrderDateByConnection` directly.
   * A connection absent from the returned Map has zero ingested orders.
   * Deliberately includes every `recordStatus` (including `source_deleted` /
   * `awaiting_mapping` / `failed` / cancelled) — a coverage/freshness fact
   * about the connection's oldest ingested order, not a health or revenue
   * figure, so no administrative-bucket exclusion applies.
   */
  getEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>>;

  /**
   * How many orders carry at least one COUNTED OMS inert state (#2352/#2353)?
   *
   * The cross-context seam for the `Needs attention (N)` count on the
   * who-decides surface — the `getEarliestOrderDateByConnection` (#2083) and
   * `getFailedSyncValueSummary` (#1983) precedent: a sibling context reads
   * through this interface, never `OrderRecordRepositoryPort`, which is an
   * intra-context contract.
   *
   * Install-wide and unscoped, deliberately distinct from the filter-scoped
   * `omsAttention` count in the orders summary aggregate: the who-decides page
   * has no filter scope to pass, and inventing one would make its number depend
   * on a scope no operator chose. Both read one predicate, so they cannot drift.
   *
   * The ORDER half only — return-scoped states are counted on the returns side.
   */
  countOrdersWithOmsAttention(): Promise<number>;

  /**
   * Which markets the operator has orders from, and how many (#2518, ADR-066).
   *
   * A clean instance has no sales-document routing, and nothing today says
   * which markets need a decision - the failure is invisible until someone
   * notices no documents exist. OpenLinker already knows where its orders are
   * routed, so this derives the answer instead of asking for it.
   *
   * The cross-context surface the sales-document settings page uses -
   * repository ports are forbidden across context boundaries per
   * architecture-overview.md, so `apps/api` goes through this method rather
   * than `OrderRecordRepositoryPort.countOrdersByRoutingCountrySince`.
   *
   * A READ, and only a read: it creates no rule, no country default and no
   * routing. It also does not classify - a country with configured routing and
   * one without are both returned, and joining these rows against
   * `listConfiguredCountries` is the caller's job. `now` defaults to the system
   * clock; pass it explicitly in tests.
   */
  discoverSalesDocumentMarkets(now?: Date): Promise<SalesDocumentMarketDiscovery>;

  /**
   * Push a per-order fulfillment rollup (#1108) onto the order record. The
   * cross-context surface the shipping context calls after a shipment-status
   * change (`shipping → orders`, via this service — never the repository port).
   * Best-effort/idempotent; a missing order row is a no-op.
   */
  updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void>;

  /**
   * Record why item resolution failed at ingestion (#1689), honestly
   * classifying the record as `'awaiting_mapping'` (an ordinary, self-healing
   * gap) or `'source_deleted'` (a permanently unresolvable ref — the mapped
   * variant is deleted at its master). Called by `OrderIngestionService`
   * immediately before it throws so the reason isn't lost to the worker log.
   * No-op (logged, not thrown) when no record exists yet for `internalOrderId`
   * — `persistIncomingSnapshot` always runs first in the ingestion flow, so
   * this is a defensive guard, not an expected path.
   */
  markItemResolutionFailure(
    internalOrderId: string,
    input: { status: OrderRecordStatus; reason: string }
  ): Promise<void>;

  /**
   * "Value stuck in failed syncs" — the needs-attention aggregate (#1983).
   * The cross-context surface `apps/api`'s analytics composition uses —
   * repository ports are forbidden across context boundaries per
   * architecture-overview.md § "Cross-context dependencies in core", so
   * callers go through this service method instead of
   * `OrderRecordRepositoryPort.getFailedSyncValueSummary` directly.
   */
  getFailedSyncValueSummary(filters: OrderHealthSummaryFilters): Promise<FailedSyncValueSummary>;

  /**
   * Durably record the instant this order was cancelled (#1984). Called by
   * `OrderIngestionService.handleSourceCancellation` — the one ingestion path
   * that never calls `persistOrder`/`persistIncomingSnapshot`, and today
   * writes nothing to the order record at all. First-write-wins: a redelivered
   * cancel event or a later re-poll can never overwrite an already-recorded
   * instant. No-op (no throw) when no record exists yet for `internalOrderId`.
   */
  markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void>;

  /**
   * Record — or clear — why OpenLinker issued no fiscal document for this order
   * (#2100, ADR-041 decision 11: a block is never log-only).
   *
   * Called on EVERY order transition with whatever the auto-issue gate currently
   * answers, `null` included; passing `null` is the clear, and it is the ordinary
   * path rather than an edge case. Also called with `null` from the manual issue
   * endpoints, because fixing the configuration and issuing by hand fires no
   * order transition and would otherwise leave a stale reason on an invoiced
   * order.
   *
   * This is the seam the invoicing context reaches the order through — it must
   * never inject `OrderRecordRepositoryPort` (repository ports are intra-context,
   * per `docs/architecture-overview.md § "Cross-context dependencies in core"`),
   * and `AutoIssueTriggerService` must not inject this token either (its one-way
   * edge, F3). Invoicing REPORTS the block; orders WRITES it.
   */
  markSalesDocumentBlock(
    internalOrderId: string,
    block: SalesDocumentBlock | null
  ): Promise<void>;

  /**
   * Persist why the fulfilment intercept HELD this order, or clear it (#2396).
   *
   * The `fulfillment` context REPORTS the routing outcome (it is a
   * zero-sibling-edge leaf and may not inject an `orders` service); `orders`
   * WRITES it. That one-way edge is what keeps `fulfillment -> orders` from
   * becoming a DI cycle — the same shape #2100 established for the invoicing
   * gate.
   */
  markFulfillmentBlock(
    internalOrderId: string,
    block: FulfillmentBlock | null
  ): Promise<void>;

  /**
   * Mark this order packed (#2287), stamping the instant and the acting
   * operator. A plain fact — it touches no state column (`recordStatus`,
   * `fulfillmentState`, `slaState`, `OrderHealth` are all untouched) and gates
   * nothing, so it applies to every order including `omp_fulfilled` ones OL
   * never dispatches.
   *
   * Idempotent: a repeat call is a replay that returns the EXISTING stamp and
   * actor rather than re-stamping. Throws `OrderRecordNotFoundException` when
   * no record exists for `internalOrderId` — a missing row is a caller error
   * here (an operator acting on an order), unlike the residual-race tolerance
   * the event-driven writers carry.
   */
  markPacked(internalOrderId: string, packedByUserId: string): Promise<OrderRecord>;

  /**
   * Clear this order's packed fact (#2287), nulling both columns together.
   * Clearing an already-unpacked order is a no-op that returns the record
   * unchanged; an unknown order throws `OrderRecordNotFoundException`.
   */
  clearPacked(internalOrderId: string): Promise<OrderRecord>;

  /**
   * Record that the source amended this order after it was already ingested
   * (#2283) — a line removed, added or re-quantified, or the shipping address
   * edited. An internal FACT: it moves no status, fires no relay event and gates
   * nothing; it exists because ingestion overwrites the snapshot wholesale and
   * the change would otherwise leave no trace.
   *
   * Callers pass a non-empty change list — an empty one has nothing to record
   * and must not reach here. Last-write-wins (the newest observation is the
   * truthful one) and a re-observation of the SAME change list is suppressed at
   * the write, so it neither bumps `updatedAt` nor re-dates the fact.
   *
   * No-op (no throw) when no record exists for `internalOrderId`: this is
   * event-driven, so it carries the residual-race tolerance the other
   * ingestion-path writers carry rather than the operator-error posture of
   * {@link markPacked}.
   */
  recordAmendment(
    internalOrderId: string,
    observedAt: Date,
    changes: OrderAmendmentChange[]
  ): Promise<void>;

  /**
   * Headline + per-channel sales analytics for a date range (#1987) — the
   * `/analytics` KPI-strip / by-channel-table read. The cross-context surface
   * `apps/api`'s `SalesAnalyticsController` uses — repository ports are
   * forbidden across context boundaries per architecture-overview.md §
   * "Cross-context dependencies in core", so callers go through this service
   * method instead of `OrderRecordRepositoryPort.getDailyOrderAggregates` /
   * `getMedianOrderValue` or `OrderLineItemRepositoryPort.
   * getUnitsSoldByConnection` directly. Composes those three reads with the
   * existing {@link getEarliestOrderDateByConnection} (#2083) for the
   * per-channel coverage signal. Currency-mixing detection and gross/net
   * tax-treatment normalization are deliberately out of scope — see
   * #2049/ADR-040 and a separate tax-normalization effort.
   *
   * `includeBackfilledPreRollout` (#2469) carries the operator's org-wide
   * Net-Sales opt-in for backfilled pre-rollout tax rates (#2461). It is a
   * caller-supplied parameter rather than something this service resolves,
   * because the setting lives in the `analytics` context and `orders` must not
   * import it — see `OrderRecordRepositoryPort.getDailyOrderAggregates`. It
   * defaults to `false`, which is byte-identical to the pre-#2469 figure.
   */
  getSalesAndChannelAnalytics(
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout?: boolean
  ): Promise<SalesAndChannelAnalytics>;

  /**
   * Products ranked by revenue or units for a date range, each carrying its
   * own inline per-channel breakdown (#1988) — the read behind
   * `/analytics/top-products`. Same currency-correctness rule as {@link
   * getSalesAndChannelAnalytics}: a product's ranked `revenue` sums only
   * FX-stamped orders; unstamped orders' contribution is surfaced separately
   * via `unconvertedRevenue`/`unconvertedOrderCount`, never silently summed
   * in or dropped. Product-level grouping only — variant-level ranking is a
   * separate, not-yet-scoped read (spec row C3). `includeBackfilledPreRollout`
   * carries the same meaning as in {@link getSalesAndChannelAnalytics}, and is
   * applied at LINE grain here — a pre-existing grain difference, not one the
   * flag introduces.
   */
  getTopProducts(
    filters: TopProductFilters,
    includeBackfilledPreRollout?: boolean
  ): Promise<TopProductsResult>;

  /**
   * One page of T4 `order.dispatch_deadline_near` candidates (#2360) — orders on
   * this connection that still need dispatching and whose deadline falls inside
   * `[now, windowEnd]`.
   *
   * The automation context never reads orders itself; the worker handler
   * composes this read with the emission seam, which is what keeps
   * `automation` free of any sibling-context import (#2100's direction).
   */
  findDispatchDeadlineCandidates(
    connectionId: string,
    input: { windowEnd: Date; now: Date; limit: number; offset: number }
  ): Promise<OrderRecord[]>;

  /**
   * One product's sales split by variant, per channel (#2765) — the
   * drill-down behind the Top Products expand panel, fetched lazily only
   * when an operator actually expands a row (mirrors the products cockpit's
   * own `ProductRowDetail` lazy-query precedent). Never embedded in {@link
   * getTopProducts}'s list response, which pages up to 20 rows at once —
   * running this query eagerly for every row would cost 20× the work for
   * detail almost none of it gets opened.
   *
   * Same currency-correctness rules as {@link getTopProducts}. Catalog
   * metadata (sku/attributes) and stock are NOT part of this core shape —
   * composed at the apps/api layer, same reasoning as `getTopProducts`.
   */
  getTopProductVariantSales(
    productId: string,
    filters: SalesAnalyticsFilters
  ): Promise<VariantSalesResult>;

  /**
   * Data Coverage `'currency'` category drill-down (#2464/#2466) — the
   * cross-context surface `AnalyticsCoverageController`'s
   * `GET /analytics/coverage` uses. Repository ports are forbidden across
   * context boundaries (`docs/architecture-overview.md § Cross-context
   * dependencies in core`), so this thin pass-through to {@link
   * OrderRecordRepositoryPort.findCurrencyMismatchOrders} is the seam.
   * `currentReportingCurrency` is an explicit caller-supplied param rather
   * than resolved internally (unlike {@link getSalesAndChannelAnalytics}),
   * because the same request also threads it into
   * `ITaxCoverageDetectionService`'s call — resolving it twice per request
   * risks the two reads straddling a setting change mid-request.
   */
  getCurrencyMismatchOrders(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedCurrencyMismatchOrders>;

  /**
   * Data Coverage `'currency'` category aggregate-by-connection (#2713) —
   * thin pass-through to {@link
   * OrderRecordRepositoryPort.findCurrencyMismatchOrdersByConnection}, for
   * the same cross-context-boundary reason as {@link
   * getCurrencyMismatchOrders}. Unlike that method, no line-item enrichment
   * runs here — a count carries no `lineProducts` to attach.
   */
  getCurrencyMismatchOrdersByConnection(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<CoverageConnectionAggregateRow[]>;

  /**
   * Data Coverage `'product-matching'` category drill-down (#2466) — thin
   * pass-through to {@link
   * OrderRecordRepositoryPort.findProductMatchingErrorOrders}, for the same
   * cross-context-boundary reason as {@link getCurrencyMismatchOrders}.
   */
  getProductMatchingErrorOrders(
    filters: OrderHealthSummaryFilters,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedProductMatchingErrorOrders>;
}

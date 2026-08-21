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
import type { SalesDocumentBlock } from '@openlinker/core/sales-documents';
import type {
  SalesAnalyticsFilters,
  SalesAndChannelAnalytics,
} from '../../domain/types/order-sales-analytics.types';

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
   */
  getSalesAndChannelAnalytics(filters: SalesAnalyticsFilters): Promise<SalesAndChannelAnalytics>;
}

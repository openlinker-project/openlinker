/**
 * Order Record Service
 *
 * Service for persisting order records with PII-aware snapshot handling.
 * Creates order snapshots that respect OL_STORE_PII configuration, allowing
 * retry/debug without re-polling source systems.
 *
 * @module libs/core/src/orders/application/services
 * @implements {IOrderRecordService}
 */
import { Injectable, Inject } from '@nestjs/common';
import type { Order, OrderDispatchWindow } from '../../domain/types/order.types';
import {
  encodeBuyerTaxIdColumn,
  readBuyerTaxId,
} from '../../domain/types/buyer-tax-id.types';
import { OrderRecordRepositoryPort } from '../../domain/ports/order-record-repository.port';
import { OrderLineItemRepositoryPort } from '../../domain/ports/order-line-item-repository.port';
import { OrderRecord } from '../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../domain/types/order-sync.types';
import type { IOrderRecordService } from '../interfaces/order-record.service.interface';
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
import { SALES_DOCUMENT_MARKET_DISCOVERY_WINDOW_DAYS } from '@openlinker/core/sales-documents';
import type {
  SalesDocumentBlock,
  SalesDocumentMarketDiscovery,
} from '@openlinker/core/sales-documents';
import type {
  SalesAnalyticsFilters,
  SalesAndChannelAnalytics,
} from '../../domain/types/order-sales-analytics.types';
import { getPiiConfig } from '@openlinker/shared/config';
import { Logger } from '@openlinker/shared/logging';
import {
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  type IReportingCurrencySettingsService,
} from '@openlinker/core/currency';
import { IOrderFxStampService } from '../interfaces/order-fx-stamp.service.interface';
import {
  ORDER_FX_STAMP_SERVICE_TOKEN,
  ORDER_LINE_ITEM_REPOSITORY_TOKEN,
  ORDER_RECORD_REPOSITORY_TOKEN,
} from '../../orders.tokens';
import { deriveOrderAnalyticsScalars, deriveOrderLineItems } from '../../domain/order-analytics-projection';
import { buildSalesAndChannelAnalytics } from '../../domain/order-sales-aggregation';
import { buildTopProducts } from '../../domain/top-products-aggregation';
import type { TopProductFilters, TopProductsResult } from '../../domain/types/top-products.types';
import type {
  CoverageDetectionPagination,
  PaginatedCurrencyMismatchOrders,
  PaginatedProductMatchingErrorOrders,
  CoverageConnectionAggregateRow,
} from '../../domain/types/coverage-detection.types';

/** One day in milliseconds, for the market-discovery window arithmetic (#2518). */
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class OrderRecordService implements IOrderRecordService {
  private readonly logger = new Logger(OrderRecordService.name);

  constructor(
    @Inject(ORDER_RECORD_REPOSITORY_TOKEN)
    private readonly repository: OrderRecordRepositoryPort,
    @Inject(ORDER_FX_STAMP_SERVICE_TOKEN)
    private readonly fxStamp: IOrderFxStampService,
    @Inject(ORDER_LINE_ITEM_REPOSITORY_TOKEN)
    private readonly lineItemRepository: OrderLineItemRepositoryPort,
    @Inject(REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN)
    private readonly reportingCurrencySettings: IReportingCurrencySettingsService
  ) {}

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
   */
  async persistOrder(
    order: Order,
    sourceConnectionId: string,
    sourceEventId: string | null = null,
    sourceExternalUrl: string | null = null
  ): Promise<OrderRecord> {
    const piiConfig = getPiiConfig();
    const now = new Date();

    // Create PII-aware order snapshot
    const orderSnapshot: Record<string, unknown> = {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      customerId: order.customerId,
      items: order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        sku: item.sku,
        // Conditional spread keeps the snapshot key absent (not `undefined`)
        // when the source did not supply the field — the snapshot is a
        // stable JSON contract surfaced to the FE, so present-only keys keep
        // the wire shape clean and let consumers tell "missing" from "blank".
        ...(item.name !== undefined && { name: item.name }),
        ...(item.imageUrl !== undefined && { imageUrl: item.imageUrl }),
        // #2054/#2254 - the per-line tax fields. This projection is an
        // ALLOWLIST, and it is the WRITER half of the pair `readItems`
        // (`orderFromReadySnapshot`) reads back. Omitting them here loses the
        // settled rate at persistence time, so every MANUAL issuance path
        // (`POST /invoices`, bulk issue, corrections) rehydrates a rate-less
        // order and the #2248 gate refuses it - pointing the operator at a
        // product that was already configured correctly. The auto-issue path
        // composes from the live `Order` and never reads the snapshot, which is
        // why the two paths disagree unless both allowlists name the same
        // fields. Caught end to end against a live shop, not by a unit test.
        ...(item.taxRate !== undefined && { taxRate: item.taxRate }),
        ...(item.taxRateCountry !== undefined && { taxRateCountry: item.taxRateCountry }),
        ...(item.taxSource !== undefined && { taxSource: item.taxSource }),
        ...(item.taxRateReadAt !== undefined && { taxRateReadAt: item.taxRateReadAt }),
        ...(item.taxRateChannel !== undefined && { taxRateChannel: item.taxRateChannel }),
      })),
      totals: order.totals,
      shippingAddress: piiConfig.storePii
        ? order.shippingAddress
        : this.sanitizeAddress(order.shippingAddress),
      billingAddress: piiConfig.storePii
        ? order.billingAddress
        : this.sanitizeAddress(order.billingAddress),
      // Buyer email (#948) — PII-gated + present-only. Unlike addresses (which
      // get a `[REDACTED]` placeholder via sanitizeAddress), email is omitted
      // entirely under hash-only mode: there's no meaningful redaction of an
      // atomic identifier, and the privacy model keeps only `emailHash` on the
      // customer projection. Needed for the Generate-Label recipient.
      ...(piiConfig.storePii &&
        order.customerEmail !== undefined && { customerEmail: order.customerEmail }),
      // Conditional spread matches the items-level precedent above: keep the
      // snapshot key absent (not `undefined` and not `false`) when the source
      // did not supply the flag, so consumers can distinguish "Smart not
      // reported" from "Smart explicitly false".
      ...(order.deliverySmart !== undefined && { deliverySmart: order.deliverySmart }),
      ...(order.paymentStatus !== undefined && { paymentStatus: order.paymentStatus }),
      // Marketplace-sourced COD collect amount (#1435) — present-only, like
      // paymentStatus. Read back by `OrderRecord.codToCollect` for the dispatch
      // COD gate; absent for prepaid orders and sources that don't expose it.
      ...(order.codToCollect !== undefined && { codToCollect: order.codToCollect }),
      // Dispatch (ship-by) window carried through for fidelity; the scalar
      // deadline is denormalized to the `dispatchByAt` column below (#927).
      ...(order.dispatchTime !== undefined && { dispatchTime: order.dispatchTime }),
      // Buyer-placed-on-marketplace time (#926) — absent when the source didn't
      // expose one. Conditional spread keeps the key off the snapshot rather
      // than emitting `undefined`.
      ...(order.placedAt !== undefined && { placedAt: order.placedAt.toISOString() }),
      // Source-side delivery method + pickup point (#952) — present-only, like
      // deliverySmart/dispatchTime. NOT PII-gated: a carrier method id/name and a
      // public locker code aren't personal data (the locker's address is folded
      // into the PII-gated shippingAddress). Needed by the order-detail Delivery
      // panel, the Generate-Label paczkomat pre-fill, and — critically —
      // fulfillment routing, which keys on `shipping.methodId` (absent it, routing
      // always resolves to the omp_fulfilled default).
      ...(order.shipping !== undefined && { shipping: order.shipping }),
      ...(order.pickupPoint !== undefined && { pickupPoint: order.pickupPoint }),
      // Source-platform deep link (#1713) — present-only. Built by the source
      // adapter (it owns the URL scheme + base URL); the FE renders the
      // "Open order" link off this key. Absent when the source can't build one.
      ...(sourceExternalUrl !== null && { sourceExternalUrl }),
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };

    // Empty: no source payload carries destination sync state, and
    // `updateSyncStatus` is the sole writer of both `syncStatus` and
    // `syncAttempts`. The upsert excludes those columns (#2140), so this empty
    // array never reaches the row - passing one here is the ingestion path
    // declining to have an opinion, not an instruction to clear.
    const syncStatus: OrderSyncStatus[] = [];

    // `fulfillmentState` is intentionally left at its constructor default:
    // it is a rollup over the order's shipments, not a source-payload field,
    // and the upsert excludes the column so a re-ingestion can't reset the
    // value the shipping context wrote out-of-band (#2101). Same for
    // `cancelledAt` (#1984), recorded below via `recordCancellationIfNeeded`.

    // Order analytics read-model scalars (#1985) — denormalized alongside
    // dispatchByAt above, from the same already-resolved Order. See ADR-039.
    const analyticsScalars = deriveOrderAnalyticsScalars(order);

    // Buyer tax id (#2599) - denormalized so routing and gating never expand
    // JSONB, and so the value outlives the snapshot's PII redaction.
    //
    // PII-gated exactly like `customerEmail` above, and for the same reason: a
    // sole trader's tax id identifies a natural person, and `sanitizeAddress`
    // already drops it from the snapshot under hash-only mode. Keeping the
    // scalar would leave the one buyer identifier the redaction was meant to
    // remove. Not-stored reads back as "the source asserted nothing", which is
    // the honest answer for a deployment that chose not to keep it.
    const buyerTaxId = piiConfig.storePii
      ? encodeBuyerTaxIdColumn(readBuyerTaxId(order))
      : null;

    const orderRecord = new OrderRecord(
      order.id,
      order.customerId || null,
      sourceConnectionId,
      sourceEventId,
      orderSnapshot,
      syncStatus,
      'ready',
      now,
      now,
      [],
      this.deriveDispatchByAt(order.dispatchTime),
      null,
      null,
      analyticsScalars.placedAt,
      analyticsScalars.currency,
      analyticsScalars.taxTreatment,
      analyticsScalars.totalAmount,
      // The thirteen columns between here and `buyerTaxId` all default to
      // `null` and are owned by their own narrow UPDATEs (cancellation, the
      // three salesDocument* reasons, the six FX snapshot columns, the two
      // block-episode timestamps, taxRateEra). Restated explicitly only because
      // this is a positional constructor and the new argument sits past them.
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      buyerTaxId
    );

    // #1985: persist the order record AND its order_line_items rows in one
    // transaction — replaces the prior line-item set for this order so a
    // re-ingested order with a changed item list never leaves stale rows.
    const lineItems = deriveOrderLineItems(order, sourceConnectionId);
    const saved = await this.repository.upsertWithLineItems(orderRecord, lineItems);

    // Two post-upsert writers, ONE refresh (#2125). Both write columns that
    // upsertWithLineItems() deliberately excludes from its statement, so
    // `saved` cannot reflect either of them - and running each writer's own
    // re-read in sequence would leave the record stale again, because the
    // cancellation re-read happens before the stamp lands. So each writer
    // only REPORTS whether the returned record is now behind the row, and
    // the refresh runs at most once, after both.
    const cancellationWrote = await this.recordCancellationIfNeeded(
      order.id,
      order.status === 'cancelled',
      now
    );
    const fxWrote = await this.stampFx(order.id);

    return cancellationWrote || fxWrote
      ? (await this.repository.findById(order.id)) ?? saved
      : saved;
  }

  /**
   * Stamp the order's reporting-currency figure (#2125, ADR-040), inline on the
   * ingestion path.
   *
   * NEVER FAILS THE PERSIST. `IOrderFxStampService.stamp` folds every failure
   * into its outcome (degrading to the `marketplace.order.fxStamp` retry job),
   * and the defensive catch here covers the residual case of the seam itself
   * throwing: a rate provider being unreachable must not turn a successfully
   * ingested order into a failed ingestion.
   *
   * @returns whether the returned `OrderRecord` is now behind the row's
   *   reportable FX figure, i.e. whether a refresh is owed. Only a `'stamped'`
   *   outcome qualifies: `'terminal'` and `'deferred'` leave the three figure
   *   columns NULL, exactly as `upsert()` reported them, and the operational
   *   columns they do write (`fxStampedAt`, `fxIntendedCurrency`, `fxRule`) are
   *   not the financial contract this refresh exists to keep honest.
   */
  private async stampFx(internalOrderId: string): Promise<boolean> {
    try {
      const outcome = await this.fxStamp.stamp(internalOrderId);
      return outcome.kind === 'stamped';
    } catch (error) {
      this.logger.warn(
        `FX stamp seam threw for order ${internalOrderId}; the order stays persisted and ` +
          `unstamped, and the hourly reconcile sweep will re-attempt it: ` +
          (error instanceof Error ? error.message : String(error))
      );
      return false;
    }
  }

  async persistIncomingSnapshot(
    incoming: IncomingOrder,
    internalOrderId: string,
    customerId: string | null,
    sourceConnectionId: string,
    sourceEventId: string | null
  ): Promise<OrderRecord> {
    const piiConfig = getPiiConfig();
    const now = new Date();

    const snapshot: Record<string, unknown> = {
      externalOrderId: incoming.externalOrderId,
      orderNumber: incoming.orderNumber,
      status: incoming.status,
      customerExternalId: incoming.customerExternalId,
      // Items are passed through verbatim — this snapshot captures the raw
      // pre-mapping incoming order for debugging and retry. Optional fields
      // (name, imageUrl) propagate automatically; when an adapter omits one,
      // the property is absent and `JSON.stringify` drops it, matching the
      // present-only wire shape `persistOrder` emits below.
      items: incoming.items,
      totals: incoming.totals,
      shippingAddress: piiConfig.storePii
        ? incoming.shippingAddress
        : this.sanitizeAddress(incoming.shippingAddress),
      billingAddress: piiConfig.storePii
        ? incoming.billingAddress
        : this.sanitizeAddress(incoming.billingAddress),
      // Buyer email (#948) — PII-gated + present-only; see persistOrder for the
      // omit-vs-redact rationale. For "ready" orders this awaiting_mapping
      // snapshot is overwritten by persistOrder, so this write is for
      // consistency/debugging of records still awaiting item mapping (which
      // can't generate a label yet anyway) — persistOrder is the load-bearing
      // write for the label flow.
      ...(piiConfig.storePii &&
        incoming.customerEmail !== undefined && { customerEmail: incoming.customerEmail }),
      createdAt: incoming.createdAt,
      updatedAt: incoming.updatedAt,
      metadata: incoming.metadata,
      // See `persistOrder` above for the absent-vs-false rationale.
      ...(incoming.deliverySmart !== undefined && { deliverySmart: incoming.deliverySmart }),
      ...(incoming.paymentStatus !== undefined && { paymentStatus: incoming.paymentStatus }),
      // Marketplace-sourced COD collect amount (#1435) — see persistOrder.
      ...(incoming.codToCollect !== undefined && { codToCollect: incoming.codToCollect }),
      ...(incoming.dispatchTime !== undefined && { dispatchTime: incoming.dispatchTime }),
      // Buyer-placed-on-marketplace time (#926) — ISO string passed through verbatim.
      ...(incoming.placedAt !== undefined && { placedAt: incoming.placedAt }),
      // Source-side delivery method + pickup point (#952) — see persistOrder for
      // the present-only + non-PII rationale. Same fields, same placement.
      ...(incoming.shipping !== undefined && { shipping: incoming.shipping }),
      ...(incoming.pickupPoint !== undefined && { pickupPoint: incoming.pickupPoint }),
      // Source-platform deep link (#1713) — see persistOrder. Written here too so
      // records still awaiting item mapping carry the link before the ready-path
      // snapshot overwrites this one.
      ...(incoming.externalUrl !== undefined && { sourceExternalUrl: incoming.externalUrl }),
    };

    const orderRecord = new OrderRecord(
      internalOrderId,
      customerId,
      sourceConnectionId,
      sourceEventId,
      snapshot,
      [],
      'awaiting_mapping',
      now,
      now,
      [],
      this.deriveDispatchByAt(incoming.dispatchTime)
    );

    const saved = await this.repository.upsert(orderRecord);

    // No FX stamp on this path, deliberately: an `awaiting_mapping` snapshot is
    // overwritten by `persistOrder` as soon as item resolution succeeds, so
    // stamping here would be work repeated moments later for the overwhelming
    // majority of orders. An order that never leaves `awaiting_mapping` still
    // carries `totals` in this snapshot and is picked up by the reconcile sweep.
    const cancellationWrote = await this.recordCancellationIfNeeded(
      internalOrderId,
      incoming.status === 'cancelled',
      now
    );

    return cancellationWrote ? (await this.repository.findById(internalOrderId)) ?? saved : saved;
  }

  /**
   * Derive the scalar ship-by deadline (`dispatchByAt`) from a dispatch window
   * (#927) — the `.to` bound. Returns `null` when absent or unparseable, so the
   * column and SLA surfaces degrade gracefully. Re-run on every persist (both
   * the `awaiting_mapping` and `ready` paths) so a re-pulled order with a
   * changed window updates the column.
   *
   * Ship-by is populated only for sources whose adapter maps a dispatch window
   * onto the incoming order (#1776): Allegro maps the per-order
   * `delivery.time.dispatch` (marketplace-authoritative); Erli DERIVES one in
   * `ErliOrderSourceAdapter.getOrder` from `purchasedAt` + the per-offer handling
   * time (read back from `GET /products/{externalId}`, falling back to the
   * connection's `defaultDispatchTime`), taking the soonest deadline across lines
   * — Polish working-day math (weekends + PL public holidays, Europe/Warsaw) — and
   * flags the window `estimated: true`. WooCommerce carries no per-order dispatch
   * deadline and OL owns no WC handling time, so its `dispatchTime` is absent and
   * ship-by stays `null` by design. The source of truth is the source adapter;
   * this method never fabricates a window.
   */
  private deriveDispatchByAt(window: OrderDispatchWindow | undefined): Date | null {
    const to = window?.to;
    if (!to) {
      return null;
    }
    const parsed = new Date(to);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Durably record a cancellation observed by the ordinary ingestion path
   * (#1984) — the case where a source's order feed reports
   * `status: 'cancelled'` directly, rather than via the dedicated
   * `handleSourceCancellation` cancel-event path. Called AFTER `upsert()`
   * (never before): `upsert()` never touches `cancelledAt` (see the `toOrm`
   * comment in `OrderRecordRepository`), so this is the only writer, using
   * the same atomic, first-write-wins `markCancelled` the cancel-event path
   * uses — no read-before-write race between concurrent ingestion calls for
   * the same order (webhook + reconciliation poll can legitimately overlap).
   *
   * `upsert()`'s returned record never reflects `cancelledAt` (the column
   * was never sent to the database in that statement), so a re-fetch is
   * needed to return an accurate record when a cancellation was recorded;
   * the extra read is paid only on this rare path, not on every persist.
   *
   * REPORTS the write rather than performing the re-read itself (#2125): the
   * FX stamp is a second post-upsert writer and lands after this one, so a
   * re-read here would be immediately stale. The caller owns the single
   * refresh.
   *
   * @returns whether a cancellation instant was written
   */
  private async recordCancellationIfNeeded(
    internalOrderId: string,
    isCancelled: boolean,
    cancelledAt: Date
  ): Promise<boolean> {
    if (!isCancelled) {
      return false;
    }
    await this.repository.markCancelled(internalOrderId, cancelledAt);
    return true;
  }

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
  async updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus
  ): Promise<void> {
    // The service stamps `attemptedAt` so the repository UPDATE statement
    // is purely mechanical (no clock dependency in the persistence layer).
    const attempt: SyncAttempt = {
      destinationConnectionId,
      status: status.status,
      attemptedAt: new Date(),
      error: status.error,
      externalOrderId: status.externalOrderId,
      externalOrderNumber: status.externalOrderNumber,
    };
    await this.repository.updateSyncStatus(
      internalOrderId,
      destinationConnectionId,
      status,
      attempt
    );
  }

  /**
   * Get order record by ID
   *
   * Retrieves a persisted order record for retry/debug purposes.
   *
   * @param internalOrderId - Internal order ID
   * @returns Order record or null if not found
   */
  async getOrderRecord(internalOrderId: string): Promise<OrderRecord | null> {
    return this.repository.findById(internalOrderId);
  }

  async findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords> {
    return this.repository.findMany(filters, pagination);
  }

  async findByIds(internalOrderIds: string[]): Promise<OrderRecord[]> {
    return this.repository.findByIds(internalOrderIds);
  }

  async updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void> {
    await this.repository.updateFulfillmentState(internalOrderId, fulfillmentState);
  }

  async markItemResolutionFailure(
    internalOrderId: string,
    input: { status: OrderRecordStatus; reason: string }
  ): Promise<void> {
    // Narrow absolute-set on recordStatus + mappingFailureReason only (#1689
    // review) — no read-modify-write, so it can't clobber a concurrent write
    // to any other column on the same row (e.g. a syncStatus update racing
    // in from OrderSyncService). Mirrors updateFulfillmentState's pattern.
    await this.repository.updateItemResolutionFailure(internalOrderId, input);
  }

  async getFailedSyncValueSummary(
    filters: OrderHealthSummaryFilters
  ): Promise<FailedSyncValueSummary> {
    return this.repository.getFailedSyncValueSummary(filters);
  }

  async getEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>> {
    return this.repository.findEarliestOrderDateByConnection(connectionIds);
  }

  /**
   * Which markets the operator has orders from, and how many (#2518, ADR-066).
   *
   * One grouped repository read plus the window arithmetic. It writes nothing
   * and classifies nothing - see the interface for both rules. The resolved
   * window travels back with the counts so no surface has to hold its own copy
   * of the number and drift from it.
   */
  async discoverSalesDocumentMarkets(now: Date = new Date()): Promise<SalesDocumentMarketDiscovery> {
    const since = new Date(
      now.getTime() - SALES_DOCUMENT_MARKET_DISCOVERY_WINDOW_DAYS * MILLISECONDS_PER_DAY
    );
    const markets = await this.repository.countOrdersByRoutingCountrySince(since);

    return {
      windowDays: SALES_DOCUMENT_MARKET_DISCOVERY_WINDOW_DAYS,
      since: since.toISOString(),
      markets,
    };
  }

  /**
   * Durably record the instant this order was cancelled (#1984). Thin
   * pass-through to the repository's first-write-wins absolute-set — see
   * {@link OrderRecordRepositoryPort.markCancelled}.
   */
  async markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void> {
    await this.repository.markCancelled(internalOrderId, cancelledAt);
  }

  async getSalesAndChannelAnalytics(
    filters: SalesAnalyticsFilters,
    includeBackfilledPreRollout = false
  ): Promise<SalesAndChannelAnalytics> {
    // Resolved once per read, never per row (#1987 review notes) — every
    // downstream query is scoped against the SAME current-era reporting
    // currency, so a setting change mid-read can't split one response
    // across two eras.
    const currentReportingCurrency = await this.reportingCurrencySettings.resolve();

    const [dailyRows, medianOrderValue, netMedianOrderValue, unitsByConnection] =
      await Promise.all([
        this.repository.getDailyOrderAggregates(
          filters,
          currentReportingCurrency,
          includeBackfilledPreRollout
        ),
        this.repository.getMedianOrderValue(filters, currentReportingCurrency),
        this.repository.getNetMedianOrderValue(
          filters,
          currentReportingCurrency,
          includeBackfilledPreRollout
        ),
        this.lineItemRepository.getUnitsSoldByConnection(filters, currentReportingCurrency),
      ]);

    const connectionIds = [...new Set(dailyRows.map((row) => row.sourceConnectionId))];
    const earliestOrderDateByConnection = await this.getEarliestOrderDateByConnection(
      connectionIds
    );

    return buildSalesAndChannelAnalytics({
      filters,
      dailyRows,
      medianOrderValue,
      netMedianOrderValue,
      unitsByConnection,
      earliestOrderDateByConnection,
    });
  }

  /**
   * Resolves the CURRENT system reporting currency (#2049/ADR-040 bugfix)
   * before ranking, so `revenue` sums only orders stamped in that currency —
   * an order stamped under a PREVIOUS setting is a different currency era
   * (settings changes are forward-only) and would otherwise get silently
   * summed in under an arbitrary label. See {@link
   * OrderLineItemRepositoryPort.getTopProductRanking}.
   *
   * The ranking and breakdown reads below are deliberately SEQUENTIAL, not
   * `Promise.all`-parallelised like {@link getSalesAndChannelAnalytics}'s
   * three independent reads above — `getProductChannelBreakdown` is scoped
   * to the current page's `productIds`, which only exist once the ranking
   * query has returned (#2172 review, SUGGESTION 2).
   */
  async getTopProducts(
    filters: TopProductFilters,
    includeBackfilledPreRollout = false
  ): Promise<TopProductsResult> {
    const reportingCurrency = await this.reportingCurrencySettings.resolve();
    const { rows: ranking, total } = await this.lineItemRepository.getTopProductRanking(
      filters,
      reportingCurrency,
      includeBackfilledPreRollout
    );
    const productIds = ranking.map((row) => row.productId);
    const breakdown = await this.lineItemRepository.getProductChannelBreakdown(
      productIds,
      filters,
      reportingCurrency,
      includeBackfilledPreRollout
    );

    return buildTopProducts({ ranking, total, breakdown });
  }

  /**
   * Data Coverage `'currency'` category drill-down (#2464/#2466) —
   * delegates the page read to {@link
   * OrderRecordRepositoryPort.findCurrencyMismatchOrders}, then enriches
   * each row with a representative `productId`/`variantId` (#2799) via one
   * batched {@link OrderLineItemRepositoryPort.findRepresentativeLinesByOrderIds}
   * call scoped to just this page's order ids — never per-row, which would
   * turn a bounded page read into an N+1. The enrichment lives here rather
   * than inside the repository because `OrderRecordRepository` has no
   * `order_line_items` access of its own; this service already composes
   * both repositories for {@link buildTopProducts}, so the join belongs at
   * the same layer.
   */
  async getCurrencyMismatchOrders(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedCurrencyMismatchOrders> {
    const page = await this.repository.findCurrencyMismatchOrders(
      filters,
      currentReportingCurrency,
      pagination
    );

    if (page.items.length === 0) {
      return page;
    }

    const representativeLines = await this.lineItemRepository.findRepresentativeLinesByOrderIds(
      page.items.map((item) => item.internalOrderId)
    );

    return {
      ...page,
      items: page.items.map((item) => {
        const line = representativeLines.get(item.internalOrderId);
        return {
          ...item,
          productId: line?.productId ?? null,
          variantId: line?.variantId ?? null,
        };
      }),
    };
  }

  /**
   * Data Coverage `'currency'` category aggregate-by-connection (#2713) —
   * thin pass-through to {@link
   * OrderRecordRepositoryPort.findCurrencyMismatchOrdersByConnection}. No
   * line-item enrichment here (unlike {@link getCurrencyMismatchOrders}) — a
   * count carries no `productId`/`variantId` to attach.
   */
  async getCurrencyMismatchOrdersByConnection(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<CoverageConnectionAggregateRow[]> {
    return this.repository.findCurrencyMismatchOrdersByConnection(
      filters,
      currentReportingCurrency
    );
  }

  /**
   * Data Coverage `'product-matching'` category drill-down (#2466) — thin
   * pass-through to {@link
   * OrderRecordRepositoryPort.findProductMatchingErrorOrders}.
   */
  async getProductMatchingErrorOrders(
    filters: OrderHealthSummaryFilters,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedProductMatchingErrorOrders> {
    return this.repository.findProductMatchingErrorOrders(filters, pagination);
  }

  /**
   * Record or clear the sales-document block (#2100). Thin pass-through to the
   * repository's narrow absolute-set — see
   * {@link OrderRecordRepositoryPort.updateSalesDocumentBlock}. `null` clears,
   * and is the ordinary path: the auto-issue gate is level-evaluated, so this is
   * called on every transition with the current answer.
   */
  async markSalesDocumentBlock(
    internalOrderId: string,
    block: SalesDocumentBlock | null
  ): Promise<void> {
    await this.repository.updateSalesDocumentBlock(internalOrderId, block);
  }

  /**
   * Sanitize address by removing PII fields
   *
   * When PII storage is disabled, removes sensitive fields from addresses
   * while keeping structural information (hash can be computed separately).
   */
  private sanitizeAddress(
    address:
      | { address1?: string; city?: string; postalCode?: string; country?: string }
      | null
      | undefined
  ): { address1: string; city: string; postalCode: string; country: string } | undefined {
    if (!address) {
      return undefined;
    }

    return {
      address1: '[REDACTED]',
      city: '[REDACTED]',
      postalCode: '[REDACTED]',
      country: address.country ?? '', // Country code is not PII
    };
  }
}

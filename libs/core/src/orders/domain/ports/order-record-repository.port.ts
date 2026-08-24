/**
 * Order Record Repository Port
 *
 * Defines the contract for order record persistence operations.
 * This port interface specifies the persistence methods needed by application
 * services, without exposing infrastructure details (TypeORM, database, etc.).
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderRecord } from '../entities/order-record.entity';
import type { OrderLineItemDraft } from '../order-analytics-projection';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
  OrderHealthSummary,
  OrderHealthSummaryFilters,
  OrderRecordStatus,
  FailedSyncValueSummary,
} from '../types/order-record.types';
import type { OrderSlaSummary } from '../types/order-sla.types';
import type { FulfillmentRollupState } from '../types/order-fulfillment.types';
import type { SyncAttempt } from '../types/order-sync.types';
import type { SalesDocumentBlock } from '@openlinker/core/sales-documents';
import type { OrderFxIntent, OrderFxStamp } from '../types/order-fx.types';
import type { StampedReportingCurrencyCount } from '../types/order-fx-read.types';
import type { DailyOrderAggregateRow, SalesAnalyticsFilters } from '../types/order-sales-analytics.types';

export interface OrderRecordRepositoryPort {
  /**
   * Find order record by internal order ID
   */
  findById(internalOrderId: string): Promise<OrderRecord | null>;

  /**
   * Batch-find order records by internal order ID (#1995).
   *
   * A single query scoped to the given id set — the real batch a cross-context
   * list join (Shipments, Invoices) needs, as opposed to a de-duplicated
   * `Promise.all` fan-out over {@link findById}. Ids with no matching row are
   * silently omitted from the result (never throws, never pads with nulls);
   * callers join back onto their own rows via a `Map` keyed by
   * `internalOrderId`. Returns `[]` immediately for an empty `internalOrderIds`
   * input, without issuing a query.
   */
  findByIds(internalOrderIds: string[]): Promise<OrderRecord[]>;

  /**
   * Batch earliest-order-date lookup by source connection (#2083).
   *
   * `MIN(COALESCE(placedAt, createdAt))` per `sourceConnectionId`, in one
   * `GROUP BY` query — the real batch analytics-trust's coverage-window
   * read needs, as opposed to one query per connection. A connection with
   * zero matching rows is simply absent from the returned Map (mirrors
   * {@link findByIds}); callers treat a missing key as "no orders yet",
   * distinct from a present key whose value is merely old.
   *
   * Deliberately unfiltered by `recordStatus`: every row this connection has
   * ever ingested — including `source_deleted` / `awaiting_mapping` /
   * `failed` rows — reflects a real order that was placed, so it counts
   * toward "how far back this connection's data goes". This is a
   * coverage/freshness fact, not a revenue or health figure — unlike
   * {@link getFailedSyncValueSummary}'s `NOT_MAPPING_OR_DELETED` gate, which
   * exists to keep administrative buckets out of a *value* sum, no such gate
   * applies here. Mirrors the already-documented decision to also include
   * cancelled orders.
   */
  findEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>>;

  /**
   * Upsert order record (create or update)
   * Uses internalOrderId as the primary key.
   *
   * Writes only the columns the ingestion path owns. The columns written
   * out-of-band by a narrow, atomic UPDATE - `syncStatus` / `syncAttempts`
   * (#2140, {@link updateSyncStatus}), `fulfillmentState` (#2101,
   * {@link updateFulfillmentState}), `cancelledAt` (#1984,
   * {@link markCancelled}), the three `salesDocument*` columns (#2100,
   * {@link updateSalesDocumentBlock}) and the six FX snapshot columns (#2124,
   * {@link claimFxIntentIfAbsent} / {@link stampFxIfAbsent}) - are NOT part of
   * the write set, so a re-ingestion of the same order cannot reset them. The
   * returned record therefore reports all of them as empty (`[]` / `null`)
   * whatever the row holds; re-read via {@link findById} when their live value
   * matters.
   */
  upsert(orderRecord: OrderRecord): Promise<OrderRecord>;

  /**
   * Upsert the order record AND its `order_line_items` rows in one
   * transaction (#1985) — the `'ready'`-path write. `lineItems` replaces the
   * order's entire prior line-item set (delete-then-reinsert), so re-ingesting
   * an order with a changed item list never leaves stale rows behind. Both
   * writes commit or roll back together; a failure on either side leaves
   * `order_records` and `order_line_items` consistent with each other.
   */
  upsertWithLineItems(
    orderRecord: OrderRecord,
    lineItems: OrderLineItemDraft[]
  ): Promise<OrderRecord>;

  /**
   * Update sync status for a destination connection.
   *
   * Atomically (single SQL statement):
   *   1. upserts the per-destination row in `syncStatus` (current state),
   *   2. appends `attempt` to `syncAttempts`, keeping at most the documented
   *      per-destination cap of most-recent entries.
   *
   * Throws `OrderRecordNotFoundException` if no row matches `internalOrderId`.
   *
   * Sole writer of both columns - {@link upsert} deliberately omits them
   * (#2140), so nothing else can reset the attempt history it appends to.
   */
  updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderRecord['syncStatus'][0],
    attempt: SyncAttempt
  ): Promise<void>;

  /**
   * Find order records with filters and pagination
   */
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords>;

  /**
   * Count order records per derived health bucket (#929).
   *
   * Single aggregate query partitioning every record in scope into exactly one
   * bucket using the canonical precedence on `OrderHealthValues`. The returned
   * `total` equals the sum of the four buckets. Scope is the source/customer/
   * date subset only — `health` itself is intentionally not a valid input.
   */
  countByHealth(filters: OrderHealthSummaryFilters): Promise<OrderHealthSummary>;

  /**
   * Count order records per ship-by SLA bucket (#1108) for the list KPI strip.
   * Same scope subset + partition semantics as {@link countByHealth}; encodes
   * the {@link SlaState} precedence (incl. cleared-once-shipped) against the
   * server clock.
   */
  countBySla(filters: OrderHealthSummaryFilters): Promise<OrderSlaSummary>;

  /**
   * "Value stuck in failed syncs" — the needs-attention aggregate (#1983).
   * Same scope subset + `HAS_FAILED` / not-mapping / not-source-deleted
   * partition as {@link countByHealth}'s `needsAttention` bucket, but reports
   * the summed order value (and its oldest failure) rather than just a count.
   */
  getFailedSyncValueSummary(filters: OrderHealthSummaryFilters): Promise<FailedSyncValueSummary>;

  /**
   * Daily, per-connection revenue/order-count aggregates for the sales &
   * channel analytics read (#1987). Scope: `recordStatus = 'ready' AND
   * placedAt IS NOT NULL AND totalAmount IS NOT NULL AND placedAt` within
   * `[filters.from, filters.to)`, optionally narrowed to one connection.
   * Cancelled orders (`cancelledAt IS NOT NULL`) are split into their own
   * `cancelledCount`/`cancelledValue` columns rather than being excluded from
   * the result entirely — the aggregation layer sums them separately so a
   * cancelled order is reported, not silently dropped. One row per
   * `(day, sourceConnectionId)` pair that has at least one matching order;
   * a day/connection with none is simply absent, mirroring the "absent key =
   * no data" convention used by {@link getFailedSyncValueSummary} and
   * `findEarliestOrderDateByConnection`.
   *
   * Currency correctness (#2049/ADR-040 follow-up, and #1987 review notes —
   * porting #2172's `getTopProductRanking` fix so both `/analytics` reads
   * agree on which orders are comparable): `orderCount`/`revenue` are
   * restricted to `reportingCurrency = currentReportingCurrency` — the
   * deployment's CURRENT setting, never a bare `IS NOT NULL` — and computed
   * from `reportingTotalAmount`. `reportingCurrency` is pinned at first stamp
   * and never moves (ADR-040), so `IS NOT NULL` alone would sum two
   * currencies into one `revenue` after an operator changes the reporting
   * setting (#2096 restatement). A prior-era stamp is therefore folded into
   * the unconverted bucket alongside never-stamped rows — both report via
   * `unconvertedCount`/`unconvertedValue` (native `totalAmount`,
   * informational, may mix currencies) rather than being silently summed
   * into `revenue` or silently dropped. `cancelledValue` stays on native
   * `totalAmount`, unchanged.
   *
   * `unconvertedCurrency` (#1987 scope, not an FX-epic deliverable —
   * `order_records.currency` predates #2049) labels `unconvertedValue` with
   * the one native currency shared by every unconverted, non-cancelled order
   * this day/connection, or `null` when that set mixes currencies, contains
   * a row with no recorded native currency, or is empty — nothing to label.
   */
  getDailyOrderAggregates(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<DailyOrderAggregateRow[]>;

  /**
   * Headline median order value for the sales & channel analytics read
   * (#1987), via `PERCENTILE_CONT(0.5)`. Same scope as
   * {@link getDailyOrderAggregates} but additionally excludes cancelled
   * orders (`cancelledAt IS NULL`) — median is a headline-only figure, never
   * computed per channel. Returns `null` when no row matches (an empty
   * ordered-set aggregate), which the aggregation layer coalesces to `0`.
   *
   * Currency correctness: computed over `reportingTotalAmount`, restricted
   * to `reportingCurrency = currentReportingCurrency` — the same current-era
   * stamped subset {@link getDailyOrderAggregates} uses for `revenue`.
   */
  getMedianOrderValue(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<number | null>;

  /**
   * VAT-exclusive counterpart of {@link getMedianOrderValue} (net-sales
   * tax-rate epic) — same scope, additionally restricted to orders that are
   * not pre-rollout history (ADR-063 § Consequences) and carry a resolvable
   * tax-rate fraction on every line. `null` on an empty ordered-set, same
   * convention as the gross median.
   */
  getNetMedianOrderValue(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<number | null>;

  /**
   * Push a per-order fulfillment rollup (#1108) onto the order record. Called
   * from the shipping context after a shipment-status change (best-effort
   * projection). Idempotent absolute-set; a missing order row is a no-op (never
   * throws) so it can't fail the shipment operation.
   *
   * Sole writer of the column - {@link upsert} deliberately omits it (#2101).
   */
  updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void>;

  /**
   * Push the honest item-resolution-failure state onto the order record
   * (#1689) — either the ordinary, self-healing `'awaiting_mapping'` gap or
   * the permanently-unresolvable `'source_deleted'` state, with the
   * operator-facing reason. Narrow absolute-set (no read-modify-write),
   * mirroring {@link updateFulfillmentState}. No-op (no throw) when the order
   * row doesn't exist — the ingestion flow always persists the incoming
   * snapshot before item resolution runs, so this should never happen in
   * practice; it's a defensive guard, not an expected path.
   */
  updateItemResolutionFailure(
    internalOrderId: string,
    input: { status: OrderRecordStatus; reason: string }
  ): Promise<void>;

  /**
   * Durably record the instant the source reported this order cancelled
   * (#1984), directly from `handleSourceCancellation` — the one ingestion
   * path that never calls `persistOrder`/`persistIncomingSnapshot`.
   * First-write-wins (`COALESCE`): a redelivered cancel event or a later
   * re-poll can never overwrite an already-recorded cancellation instant.
   * No-op (no throw) when the order row doesn't exist yet — mirrors
   * {@link updateFulfillmentState}'s residual-race tolerance (#1160: a cancel
   * event racing ahead of the order's own create/sync job).
   */
  markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void>;

  /**
   * Set — or clear — the reason OpenLinker issued no fiscal document for this
   * order (#2100, ADR-041 decision 11). Narrow absolute-set on the three
   * `salesDocumentBlock*` columns only, mirroring
   * {@link updateItemResolutionFailure}, so it can't clobber a concurrent write
   * to any other column on the same row.
   *
   * Passing `null` CLEARS all three columns, and that is the primary path, not an
   * edge case: the auto-issue gate is level-evaluated, so this is called on
   * every order transition with whatever the current answer is. Last write
   * wins by design — the newest evaluation is the truthful one.
   *
   * No-op (no throw) when the order row doesn't exist, mirroring
   * {@link updateFulfillmentState}'s residual-race tolerance.
   */
  updateSalesDocumentBlock(
    internalOrderId: string,
    block: SalesDocumentBlock | null
  ): Promise<void>;

  /**
   * Claim the first-attempt FX intent (#2124, ADR-040 § Decision 5) — writes
   * `fxIntendedCurrency` + `fxRule` and nothing else, guarded on
   * `fxIntendedCurrency IS NULL` so exactly one concurrent attempt can win.
   *
   * Returns `true` for the winner and `false` for a loser, which then re-reads
   * the row and adopts the winner's intent instead of pinning its own — two
   * concurrent first attempts must never resolve to different currencies for
   * one order. `false` is also returned when no row matches the id at all
   * (never throws), the same residual-race tolerance
   * {@link updateFulfillmentState} carries.
   *
   * Deliberately NOT keyed on `reportingCurrency`: the intent is claimed
   * *before* any rate lookup, so at that point the stamp columns are still
   * NULL by definition.
   */
  claimFxIntentIfAbsent(internalOrderId: string, intent: OrderFxIntent): Promise<boolean>;

  /**
   * Stamp the order's reporting-currency figures at most once (#2124) — one
   * guarded `UPDATE` over all five stamp columns, so the group can never
   * half-apply, matched on `reportingCurrency IS NULL`.
   *
   * The predicate is `reportingCurrency`, NOT `fxIntendedCurrency`: by the time
   * a stamp is attempted the intent has deliberately been claimed, so guarding
   * on it would reject every stamp.
   *
   * Returns `true` when this call wrote the stamp and `false` when a stamp was
   * already present (or no row matched) — in which case nothing was written and
   * the existing, already-reported figure survives untouched. Sole writer of
   * these columns together with {@link claimFxIntentIfAbsent}; {@link upsert}
   * omits them so a re-ingestion cannot move a stamped financial figure.
   */
  stampFxIfAbsent(internalOrderId: string, stamp: OrderFxStamp): Promise<boolean>;

  /**
   * Record that a stamp attempt reached a TERMINAL answer (#2125) - writes
   * `fxStampedAt` and NOTHING else, so the row keeps `reportingCurrency`,
   * `reportingTotalAmount` and `exchangeRateId` NULL (which is exactly what the
   * `ck_order_records_fx_group` CHECK's first arm allows).
   *
   * A separate write from {@link stampFxIfAbsent} because a terminal answer has
   * no figure to stamp, and `OrderFxStamp` requires one. What it buys is the
   * BOUNDEDNESS of the reconcile sweep: the sweep selects on
   * `fxStampedAt IS NULL AND reportingCurrency IS NULL`, so without this write a
   * permanently-unstampable order (no `placedAt`, unsupported pair) would be
   * re-read and re-answered on every hourly tick forever.
   *
   * Guarded on `reportingCurrency IS NULL` ALONE, so it can never touch a stamped
   * row - the figure is the thing that is immutable. Returns `true` when this
   * call wrote; `false` when it did not (already stamped, or no row matched -
   * never throws).
   *
   * It deliberately does NOT also require `fxStampedAt IS NULL` (#2135 review,
   * finding 1). The sweep re-admits a terminal-but-figureless row once its marker
   * ages past its cooldown, so a re-answer has to move the marker forward;
   * refusing the write would leave the stale instant in place and the row would
   * be re-tried on every subsequent tick instead of once per cooldown.
   *
   * Deliberately NOT a permanent gate on stamping either: `stampFxIfAbsent` still
   * keys on `reportingCurrency IS NULL`, so a re-ingestion that repairs the
   * snapshot (a source re-poll finally reporting `placedAt`) can still stamp the
   * order inline.
   */
  markFxTerminal(internalOrderId: string, fxStampedAt: Date): Promise<boolean>;

  /**
   * One bounded page of orders that still carry NO reported figure (#2125), for
   * the reconcile sweep.
   *
   * Predicate: `reportingCurrency IS NULL` AND (`fxStampedAt IS NULL` OR
   * `fxStampedAt < options.terminalRetryBefore`), scoped to `sourceConnectionId`
   * and to rows created at or after `options.createdSince`. Every bound matters,
   * for a different reason:
   *
   *  - `reportingCurrency IS NULL` is the invariant, present in both arms: a row
   *    that carries a figure is never re-entered, so a stamp stays immutable.
   *  - `createdSince` keeps a permanently unstampable historical backlog from
   *    crowding out live orders, and stops the whole pre-feature table being
   *    re-selected on every tick forever.
   *  - `terminalRetryBefore` is the recovery arm (#2135 review, finding 1). A
   *    terminal answer is terminal about the CLASSIFICATION, not about the world:
   *    `no-rate-source` clears when the host is rewired and a throttle-induced
   *    `unsupported-pair` clears by itself, so a marker older than the cooldown
   *    earns one more attempt rather than costing the order its figure forever.
   *
   * Returns ids only: the sweep re-enters the stamp through the same
   * `stamp(internalOrderId)` signature every other caller uses, so hydrating
   * whole records here would be work the stamp immediately repeats.
   */
  findUnstampedFxOrderIds(
    sourceConnectionId: string,
    options: { limit: number; createdSince: Date; terminalRetryBefore: Date }
  ): Promise<string[]>;

  /**
   * The distinct set of order-native currencies OpenLinker has already
   * ingested, feeding the reporting-currency coverage advisory.
   *
   * A SET, not a winner: no connection filter, no ordering, no `LIMIT` — the
   * advisory needs to know every currency that would have to be convertible,
   * not the most common one. Read out of the order snapshot (`totals.currency`)
   * because `order_records` carries no native currency column yet (#1985);
   * values that are not JSON strings are skipped rather than cast, so a
   * malformed snapshot cannot fail the read.
   */
  listDistinctNativeCurrencies(): Promise<string[]>;

  /**
   * How many rows already carry an FX stamp, grouped by the reporting currency
   * they were stamped in (#2126).
   *
   * The read behind "changing this setting splits history": a stamp is
   * immutable, so every existing row keeps the currency it was stamped in and a
   * deployment can legitimately hold several reporting-currency eras. Grouped
   * rather than totalled because the era breakdown is the operator-facing fact
   * and cannot be recovered from a bare total.
   *
   * Keyed on `reportingCurrency IS NOT NULL`, which is the same "is this row
   * stamped?" predicate {@link stampFxIfAbsent} guards on - never
   * `exchangeRateId`, which is legitimately NULL on a same-currency stamp.
   * Rows that are unstamped (including terminal-unstamped ones) are absent from
   * the result rather than reported under a `null` key.
   */
  countStampedByReportingCurrency(): Promise<StampedReportingCurrencyCount[]>;
}

/**
 * Order Line Item Repository Port
 *
 * Mostly read-only contract for `order_line_items` (#1985). The write path
 * for a line's normal lifecycle (create/replace) is owned by
 * `OrderRecordRepositoryPort.upsertWithLineItems` (a single transaction with
 * the parent `order_records` row) — most methods here exist for standalone
 * reads by tests and downstream aggregates (#1987/#1988), which query this
 * table directly rather than through a generic method here (mirrors how
 * `countByHealth`/`countBySla` were added straight to `OrderRecordRepository`
 * rather than through a generic query API).
 *
 * {@link findPageWithNoTaxRate} and {@link backfillTaxRate} (#2440) are the
 * one deliberate exception: a narrow, guarded write for a line whose rate was
 * never settled at ingestion, owned by `TaxRateBackfillService` alone. It
 * never touches the ordinary upsert path.
 *
 * @module libs/core/src/orders/domain/ports
 */
import type { OrderLineItem } from '../entities/order-line-item.entity';
import type { ConnectionUnitsSold, SalesAnalyticsFilters } from '../types/order-sales-analytics.types';
import type { ProductChannelBreakdownRow, ProductRankingRow, TopProductFilters } from '../types/top-products.types';

export interface OrderLineItemRepositoryPort {
  /**
   * Find every line item for one order, ordered by `lineNumber`.
   */
  findByOrderId(orderRecordId: string): Promise<OrderLineItem[]>;

  /**
   * Units sold per source connection for the sales & channel analytics read
   * (#1987) — `SUM(quantity)` grouped by `sourceConnectionId`, joined back to
   * the parent `order_records` row to apply the same `recordStatus = 'ready'
   * AND cancelledAt IS NULL` scope as {@link
   * OrderRecordRepositoryPort.getDailyOrderAggregates}. The date-range
   * predicate itself runs against `order_line_items.placedAt` (denormalized
   * from the parent order, #1985), not the join. A connection with zero
   * matching lines is simply absent from the returned Map (mirrors the
   * "absent key = no data" convention used elsewhere in this context).
   *
   * Split into `unitsSold`/`unconvertedUnitsSold` on the SAME
   * `reportingCurrency = currentReportingCurrency` population
   * `getDailyOrderAggregates` uses for `orderCount`/`revenue` (#1987 review,
   * IMPORTANT 1) — before this fix `units` summed every non-cancelled line
   * regardless of stamp state, so a deployment with pre-#2049 history could
   * read `orderCount: 0` next to a non-zero `unitsSold` for the same range. A
   * caller computing units-per-order now divides two numbers describing the
   * same orders.
   */
  getUnitsSoldByConnection(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<Map<string, ConnectionUnitsSold>>;

  /**
   * A page of products ranked by `filters.sortBy`, aggregated across every
   * channel, plus the total distinct-product count in scope (for pagination)
   * — the top-products read's ranking half (#1988). Same
   * `recordStatus = 'ready' AND cancelledAt IS NULL` scope as {@link
   * getUnitsSoldByConnection}. Revenue ranking sums only orders stamped in
   * `reportingCurrency`, the CURRENT system reporting currency (#2049/ADR-040
   * bugfix) — never merely `reportingCurrency IS NOT NULL`. An order stamped
   * under a PREVIOUS reporting-currency setting is a different currency era
   * (settings changes are forward-only, ADR-040 § Decision 7) and would
   * otherwise get silently summed into `revenue` under an arbitrary label.
   * Such orders' native-currency contribution is folded into
   * `unconvertedRevenue`/`unconvertedOrderCount` alongside never-stamped
   * orders — both are "not in the current reporting currency", disclosed
   * rather than mixed in — same rule {@link
   * OrderRecordRepositoryPort.getDailyOrderAggregates} applies at the order
   * level.
   * `includeBackfilledPreRollout` (#2469) is the operator's Net-Sales opt-in
   * for backfilled pre-rollout tax rates — see
   * `OrderRecordRepositoryPort.getDailyOrderAggregates` for why it arrives as
   * a parameter rather than being read here, and `netSalesEraEligibleSql` for
   * exactly what `true` admits. This read applies it at LINE grain, which is a
   * pre-existing grain difference against the order-level aggregates rather
   * than something the flag introduces.
   */
  getTopProductRanking(
    filters: TopProductFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout?: boolean
  ): Promise<{ rows: ProductRankingRow[]; total: number }>;

  /**
   * Per-channel breakdown for an explicit, already-paged set of product ids
   * — the top-products read's inline channel-split half (#1988). Callers
   * MUST pass only the current page's product ids (never the full scoped
   * set) to keep this query's cost bounded by page size, not catalogue size.
   * `reportingCurrency` is the CURRENT system reporting currency — same
   * meaning and same bugfix as {@link getTopProductRanking}'s parameter of
   * the same name; `includeBackfilledPreRollout` likewise.
   */
  getProductChannelBreakdown(
    productIds: string[],
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout?: boolean
  ): Promise<ProductChannelBreakdownRow[]>;

  /**
   * A page of one connection's rate-less lines for the tax-rate backfill
   * sweep (#2440), scanning `IDX_order_line_items_no_tax_rate` (`WHERE
   * "taxRate" IS NULL`) further scoped to `sourceConnectionId`.
   *
   * Partitioned by connection for the same reason
   * `marketplace.order.fxStampSweep` partitions by `OrderSource` connection
   * despite the underlying fact being connection-agnostic: `SyncJob.connectionId`
   * is non-nullable, so the fan-out that already exists per source connection
   * is also the natural partition of this frontier — the rate itself is not
   * connection-scoped, only the sweep's unit of work is.
   *
   * Ordered by `id` for a stable, resumable cursor — `afterId` excludes rows
   * at or before the given id rather than paging by offset, so a row the
   * previous page already wrote past can never be re-served after a
   * concurrent write shifts an offset-based page.
   */
  findPageWithNoTaxRate(input: {
    sourceConnectionId: string;
    limit: number;
    afterId: string | null;
  }): Promise<OrderLineItem[]>;

  /**
   * Write a backfilled rate onto exactly one line (#2440), guarded by
   * `WHERE "taxRate" IS NULL` so a concurrent live ingestion that has since
   * settled the same line is never overwritten — the guard is redundant with
   * the caller's own page predicate but is not trusted alone, since the two
   * reads are not in the same transaction.
   */
  backfillTaxRate(
    id: string,
    patch: { taxRate: string; taxSource: 'backfill'; taxRateReadAt: Date }
  ): Promise<void>;
}

/**
 * Order Line Item Repository Port
 *
 * Read-only contract for `order_line_items` (#1985). The write path is owned
 * by `OrderRecordRepositoryPort.upsertWithLineItems` (a single transaction
 * with the parent `order_records` row) — this port exists for standalone
 * reads by tests and future downstream aggregates (#1987/#1988), which query
 * this table directly rather than through a generic method here (mirrors how
 * `countByHealth`/`countBySla` were added straight to `OrderRecordRepository`
 * rather than through a generic query API).
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
   */
  getTopProductRanking(
    filters: TopProductFilters,
    reportingCurrency: string
  ): Promise<{ rows: ProductRankingRow[]; total: number }>;

  /**
   * Per-channel breakdown for an explicit, already-paged set of product ids
   * — the top-products read's inline channel-split half (#1988). Callers
   * MUST pass only the current page's product ids (never the full scoped
   * set) to keep this query's cost bounded by page size, not catalogue size.
   * `reportingCurrency` is the CURRENT system reporting currency — same
   * meaning and same bugfix as {@link getTopProductRanking}'s parameter of
   * the same name.
   */
  getProductChannelBreakdown(
    productIds: string[],
    filters: SalesAnalyticsFilters,
    reportingCurrency: string
  ): Promise<ProductChannelBreakdownRow[]>;
}

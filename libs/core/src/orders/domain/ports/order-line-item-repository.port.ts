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
import type { SalesAnalyticsFilters } from '../types/order-sales-analytics.types';
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
   */
  getUnitsSoldByConnection(filters: SalesAnalyticsFilters): Promise<Map<string, number>>;

  /**
   * A page of products ranked by `filters.sortBy`, aggregated across every
   * channel, plus the total distinct-product count in scope (for pagination)
   * — the top-products read's ranking half (#1988). Same
   * `recordStatus = 'ready' AND cancelledAt IS NULL` scope as {@link
   * getUnitsSoldByConnection}. Revenue ranking sums only FX-stamped orders
   * (`reportingCurrency IS NOT NULL`); unstamped orders' native-currency
   * contribution is reported separately, never silently summed in or
   * dropped — same rule {@link OrderRecordRepositoryPort.getDailyOrderAggregates}
   * applies at the order level.
   */
  getTopProductRanking(
    filters: TopProductFilters
  ): Promise<{ rows: ProductRankingRow[]; total: number }>;

  /**
   * Per-channel breakdown for an explicit, already-paged set of product ids
   * — the top-products read's inline channel-split half (#1988). Callers
   * MUST pass only the current page's product ids (never the full scoped
   * set) to keep this query's cost bounded by page size, not catalogue size.
   */
  getProductChannelBreakdown(
    productIds: string[],
    filters: SalesAnalyticsFilters
  ): Promise<ProductChannelBreakdownRow[]>;
}

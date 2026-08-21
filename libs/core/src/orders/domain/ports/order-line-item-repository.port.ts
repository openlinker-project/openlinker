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
}

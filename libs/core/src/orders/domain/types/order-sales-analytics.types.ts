/**
 * Order Sales Analytics Types
 *
 * Shapes for the `/analytics` sales & channel aggregates read (#1987) — the
 * KPI-strip / by-channel-table backend behind `IOrderRecordService.
 * getSalesAndChannelAnalytics`. Built on top of the #1985 read model
 * (`order_records.placedAt/totalAmount/cancelledAt`, `order_line_items`).
 *
 * Currency-mixing detection and gross/net tax-treatment normalization are
 * deliberately out of scope here — see #2049/ADR-040 (currency) and a
 * separate tax-normalization effort. `totalAmount` is summed as-is.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Date-range + optional channel scope for a sales-analytics read.
 * `from` is inclusive, `to` is exclusive — `[from, to)`.
 */
export interface SalesAnalyticsFilters {
  from: Date;
  to: Date;
  sourceConnectionId?: string;
}

/**
 * One raw grouped row from `OrderRecordRepositoryPort.getDailyOrderAggregates`
 * — `order_records` grouped by day (via `placedAt`) and source connection.
 * Internal to the `orders` context: consumed only by the pure aggregation
 * function, never crosses the barrel.
 */
export interface DailyOrderAggregateRow {
  day: Date;
  sourceConnectionId: string;
  orderCount: number;
  revenue: number;
  cancelledCount: number;
  cancelledValue: number;
}

/**
 * One point of the 7-day daily trend series (revenue + order count only —
 * AOV/median/units carry no trend, per the #1987 scope).
 */
export interface DailyTrendPoint {
  date: string; // yyyy-mm-dd
  revenue: number;
  orderCount: number;
}

/**
 * Headline (all-channel) sales figures for a date range.
 */
export interface SalesAnalyticsHeadline {
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  medianOrderValue: number;
  unitsSold: number;
  cancelledCount: number;
  cancelledValue: number;
  trend: DailyTrendPoint[];
}

/**
 * Per-source-connection sales figures. Median is deliberately headline-only
 * (per the #1987 issue's own scope clarification) and therefore absent here.
 */
export interface ChannelSalesAnalytics {
  sourceConnectionId: string;
  revenue: number;
  orderCount: number;
  averageOrderValue: number;
  unitsSold: number;
  /** Share of headline revenue, `0` when headline revenue is `0`. */
  revenueShare: number;
  trend: DailyTrendPoint[];
  /**
   * `false` when this channel's oldest ingested order (per
   * `getEarliestOrderDateByConnection`, #2083) postdates the requested range
   * start — i.e. the channel cannot possibly carry data for the full range.
   */
  coverageComplete: boolean;
}

/**
 * Full response shape for `GET /analytics/sales`.
 */
export interface SalesAndChannelAnalytics {
  headline: SalesAnalyticsHeadline;
  channels: ChannelSalesAnalytics[];
}

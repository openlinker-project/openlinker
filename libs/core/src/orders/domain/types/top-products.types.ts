/**
 * Top Products Analytics Types
 *
 * Shapes for the `/analytics/top-products` read (#1988) — ranks products by
 * revenue or units over a date range, with an inline per-channel (per source
 * connection) breakdown on every row. Built on top of the same #1985 read
 * model `order_line_items` uses for the #1987 sales & channel aggregates.
 *
 * Currency correctness (#2049/ADR-040), same rule as `order-sales-analytics.types.ts`:
 * a product's ranked `revenue` sums only orders whose `reportingCurrency`
 * stamp has landed (`SUM(reportingTotalAmount)` per line, converted via the
 * order's own implicit FX multiplier `reportingTotalAmount / totalAmount`).
 * `unconvertedRevenue`/`unconvertedOrderCount` disclose what's excluded
 * rather than silently omitting or mixing it into `revenue`. `units` has no
 * currency and is never split this way.
 *
 * Grouping is at PRODUCT granularity only (spec rows C1/C2/D1) — variant-level
 * ranking is spec row C3, explicitly out of scope for this read (see the
 * #1988 implementation plan's non-goals).
 *
 * @module libs/core/src/orders/domain/types
 */
import type { SalesAnalyticsFilters } from './order-sales-analytics.types';

export const TopProductSortByValues = ['revenue', 'units'] as const;
export type TopProductSortBy = (typeof TopProductSortByValues)[number];

/**
 * Date-range + sort/pagination scope for the top-products read.
 */
export interface TopProductFilters extends SalesAnalyticsFilters {
  sortBy: TopProductSortBy;
  limit: number;
  offset: number;
}

/**
 * One ranked row from `OrderLineItemRepositoryPort.getTopProductRanking` —
 * `order_line_items` grouped by `productId` across every channel, ordered and
 * paged by the requested sort dimension. Internal to the `orders` context:
 * consumed only by the pure aggregation function, never crosses the barrel.
 */
export interface ProductRankingRow {
  productId: string;
  /** `SUM(quantity)` regardless of currency — units carry no FX ambiguity. */
  units: number;
  /** `SUM(unitPrice × quantity × orderFxMultiplier)` over stamped orders only. */
  revenue: number;
  /** Native-currency `SUM(unitPrice × quantity)` for unstamped orders' lines — informational, may mix currencies. */
  unconvertedRevenue: number;
  /** Distinct unstamped orders contributing to `unconvertedRevenue`. */
  unconvertedOrderCount: number;
  /** The `reportingCurrency` this row's `revenue` is expressed in — `null` only when every contributing order is unconverted. */
  currency: string | null;
}

/**
 * One row from `OrderLineItemRepositoryPort.getProductChannelBreakdown` — a
 * single product's contribution on a single source connection. Same
 * currency-correctness fields as {@link ProductRankingRow}, scoped to one
 * channel.
 */
export interface ProductChannelBreakdownRow {
  productId: string;
  sourceConnectionId: string;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  currency: string | null;
}

/**
 * One fully-assembled product row for the top-products response — a ranking
 * row plus its own per-channel breakdown. Catalog metadata (name/SKU) and the
 * cross-connection coverage-gap flag are NOT part of this core shape; they
 * are composed at the apps/api layer (see the #1988 implementation plan
 * § Architecture Mapping for why that composition lives outside `orders`).
 */
export interface TopProductView {
  productId: string;
  units: number;
  revenue: number;
  unconvertedRevenue: number;
  unconvertedOrderCount: number;
  currency: string | null;
  channels: ProductChannelBreakdownRow[];
}

/**
 * Full result of `IOrderRecordService.getTopProducts` — a page of ranked
 * products plus the total distinct-product count in scope (for pagination),
 * BEFORE paging is applied.
 */
export interface TopProductsResult {
  items: TopProductView[];
  total: number;
}

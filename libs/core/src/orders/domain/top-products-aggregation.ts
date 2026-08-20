/**
 * Top Products Aggregation
 *
 * Pure domain logic for the `/analytics/top-products` read (#1988) — merges a
 * page of ranked products with their per-channel breakdown into the response
 * shape. No I/O, no framework imports; mirrors `order-sales-aggregation.ts`'s
 * role for the #1987 sales & channel aggregates.
 *
 * @module libs/core/src/orders/domain
 */
import type {
  ProductChannelBreakdownRow,
  ProductRankingRow,
  TopProductView,
  TopProductsResult,
} from './types/top-products.types';

export interface BuildTopProductsInput {
  ranking: ProductRankingRow[];
  total: number;
  breakdown: ProductChannelBreakdownRow[];
}

/**
 * Joins each ranking row (in ranking order — the caller already sorted and
 * paged it at the SQL layer) to its own breakdown rows by `productId`. A
 * ranking row with no matching breakdown rows (shouldn't happen given both
 * queries share scope, but defended rather than assumed) gets an empty
 * `channels: []` instead of throwing.
 */
export function buildTopProducts(input: BuildTopProductsInput): TopProductsResult {
  const breakdownByProductId = new Map<string, ProductChannelBreakdownRow[]>();
  for (const row of input.breakdown) {
    const existing = breakdownByProductId.get(row.productId);
    if (existing) {
      existing.push(row);
    } else {
      breakdownByProductId.set(row.productId, [row]);
    }
  }

  const items: TopProductView[] = input.ranking.map((row) => ({
    productId: row.productId,
    units: row.units,
    revenue: row.revenue,
    unconvertedRevenue: row.unconvertedRevenue,
    unconvertedOrderCount: row.unconvertedOrderCount,
    currency: row.currency,
    unconvertedCurrency: row.unconvertedCurrency,
    channels: breakdownByProductId.get(row.productId) ?? [],
  }));

  return { items, total: input.total };
}

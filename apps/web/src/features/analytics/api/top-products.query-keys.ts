/**
 * Top products query keys
 *
 * @module features/analytics/api
 */
import type { SalesAnalyticsFilters } from './sales-analytics.types';
import type { TopProductsFilters } from './top-products.types';

export const topProductsQueryKeys = {
  topProducts: (filters: TopProductsFilters) => ['analytics', 'top-products', filters] as const,
  /** #2765 — one entry per (productId, filters), so expanding a different row or changing the date range never serves a stale cache hit from another row. */
  variantSales: (productId: string, filters: SalesAnalyticsFilters) =>
    ['analytics', 'top-products', productId, 'variants', filters] as const,
};

/**
 * Top products query keys
 *
 * @module features/analytics/api
 */
import type { TopProductsFilters } from './top-products.types';

export const topProductsQueryKeys = {
  topProducts: (filters: TopProductsFilters) => ['analytics', 'top-products', filters] as const,
};

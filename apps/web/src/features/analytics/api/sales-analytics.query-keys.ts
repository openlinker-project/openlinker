/**
 * Sales analytics query keys
 *
 * @module features/analytics/api
 */
import type { SalesAnalyticsFilters } from './sales-analytics.types';

export const salesAnalyticsQueryKeys = {
  sales: (filters: SalesAnalyticsFilters) => ['analytics', 'sales', filters] as const,
};

/**
 * Margin analytics query keys
 *
 * @module features/analytics/api
 */
import type {
  MarginBucket,
  MarginFilters,
  MarginProductsFilters,
} from './margin-analytics.types';

export const marginAnalyticsQueryKeys = {
  margin: (filters: MarginFilters, bucket: MarginBucket) =>
    ['analytics', 'margin', bucket, filters] as const,
  products: (filters: MarginProductsFilters) =>
    ['analytics', 'margin', 'products', filters] as const,
};

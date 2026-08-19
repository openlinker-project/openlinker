/**
 * Analytics Feature — Public Barrel
 *
 * @module apps/web/src/features/analytics
 */
export { useAnalyticsTrustQuery } from './hooks/use-analytics-trust-query';
export { AnalyticsTrustHeader } from './components/analytics-trust-header';
export { AnalyticsDegradationBanner } from './components/analytics-degradation-banner';
export { AnalyticsDateRangeToolbar } from './components/analytics-date-range-toolbar';
export { computePresetRange } from './lib/date-range.lib';
export type { AnalyticsTrustSnapshot, ConnectionIngestionTrust } from './api/analytics-trust.types';

export { useSalesAnalyticsQuery } from './hooks/use-sales-analytics-query';
export { AnalyticsKpiStrip } from './components/analytics-kpi-strip';
export { ChannelSalesTable } from './components/channel-sales-table';
export type {
  ChannelRevenueBasis,
  ChannelSalesAnalytics,
  ChannelTaxTreatmentSummary,
  DailyTrendPoint,
  SalesAnalyticsFilters,
  SalesAnalyticsHeadline,
  SalesAndChannelAnalytics,
} from './api/sales-analytics.types';

export { useTopProductsQuery } from './hooks/use-top-products-query';
export { ProductSalesTable } from './components/product-sales-table';
export { TopProductsSortByValues } from './api/top-products.types';
export type {
  ProductChannelSales,
  TopProductRow,
  TopProductsFilters,
  TopProductsResult,
  TopProductsSortBy,
} from './api/top-products.types';

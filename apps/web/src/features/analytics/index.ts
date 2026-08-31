/**
 * Analytics Feature — Public Barrel
 *
 * @module apps/web/src/features/analytics
 */
export { useAnalyticsTrustQuery } from './hooks/use-analytics-trust-query';
export { useNeedsAttentionQuery } from './hooks/use-needs-attention-query';
export { AnalyticsTrustHeader } from './components/analytics-trust-header';
export { AnalyticsDegradationBanner } from './components/analytics-degradation-banner';
export { AnalyticsDateRangeToolbar } from './components/analytics-date-range-toolbar';
export { AnalyticsNeedsAttention } from './components/analytics-needs-attention';
export { computePresetRange } from './lib/date-range.lib';
export type { AnalyticsTrustSnapshot, ConnectionIngestionTrust } from './api/analytics-trust.types';
export type { NeedsAttentionSummary } from './api/needs-attention.types';

export { useSalesAnalyticsQuery } from './hooks/use-sales-analytics-query';
export { toExclusiveEndInstant } from './api/sales-analytics.api';
export { AnalyticsKpiStrip } from './components/analytics-kpi-strip';
export { ChannelSalesTable } from './components/channel-sales-table';
export { AnalyticsCurrencyPicker } from './components/analytics-currency-picker';
export { AnalyticsConvertNote } from './components/analytics-convert-note';
export { DISPLAY_CURRENCY_RATE_BASIS_VALUES } from './api/sales-analytics.types';
export type {
  ChannelSalesAnalytics,
  DailyTrendPoint,
  DisplayCurrencyConversion,
  DisplayCurrencyRateBasis,
  SalesAnalyticsFilters,
  SalesAnalyticsHeadline,
  SalesAndChannelAnalytics,
} from './api/sales-analytics.types';

export { useAnalyticsSettingsQuery } from './hooks/use-analytics-settings-query';
export { useUpdateAnalyticsSettingsMutation } from './hooks/use-update-analytics-settings-mutation';
export { RATE_BASIS_VALUES } from './api/analytics-settings.types';
export type {
  AnalyticsDisplayCurrencySource,
  AnalyticsSettingsView,
  RateBasis,
  UpdateAnalyticsSettingsInput,
} from './api/analytics-settings.types';

export { useAnalyticsCoverageQuery } from './hooks/use-analytics-coverage-query';
export { useRecalculateCurrencyMutation } from './hooks/use-recalculate-currency-mutation';
export { AnalyticsSettingsDialog } from './components/analytics-settings-dialog';
export { AnalyticsDataCoveragePanel } from './components/analytics-data-coverage-panel';
export type {
  AnalyticsCoverage,
  AnalyticsCoverageFilters,
  CoverageCategory,
  CoverageCategoryRow,
} from './api/analytics-coverage.types';
export type { AnalyticsRemediationRun, RecalculateCurrencyInput } from './api/analytics-remediation.types';

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

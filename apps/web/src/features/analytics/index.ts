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

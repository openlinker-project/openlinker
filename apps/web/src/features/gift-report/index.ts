/**
 * Gift report - public barrel (#3943)
 *
 * @module features/gift-report
 */
export { GiftBundleView } from './components/gift-bundle-view';
export { GiftCostTable } from './components/gift-cost-table';
export { GiftExportPanel } from './components/gift-export-panel';
export { GiftTotals } from './components/gift-totals';
export { useGiftBundleReportQuery, useGiftReportQuery } from './hooks/use-gift-report-query';
export { createGiftReportApi, type GiftReportApi } from './api/gift-report.api';
export { GIFT_REPORT_SOURCE_VALUES } from './api/gift-report.types';
export type {
  GiftBundleReport,
  GiftReport,
  GiftReportFilters,
  GiftReportGroup,
  GiftReportSource,
} from './api/gift-report.types';

/**
 * Gift report - public barrel (#3943)
 *
 * @module features/gift-report
 */
export { GiftBundleView } from './components/gift-bundle-view';
export { GiftCostChart } from './components/gift-cost-chart';
export { GiftCostTable, type GiftGrouping } from './components/gift-cost-table';
export { GiftExportDialog } from './components/gift-export-dialog';
export { GiftReportKpis } from './components/gift-report-kpis';
export { useGiftReportGuide } from './lib/use-gift-report-guide';
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

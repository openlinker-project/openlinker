/**
 * Gift report query keys (#3943)
 *
 * @module features/gift-report/api
 */
import type { GiftReportFilters } from './gift-report.types';

export const giftReportQueryKeys = {
  report: (filters: GiftReportFilters) => ['analytics', 'gifts', 'report', filters] as const,
  bundles: (filters: GiftReportFilters) => ['analytics', 'gifts', 'bundles', filters] as const,
};

/**
 * Gift report API client (#3943)
 *
 * @module features/gift-report/api
 */
import { buildMarginRangeParams } from '../../analytics';
import type { GiftBundleReport, GiftReport, GiftReportFilters } from './gift-report.types';

export interface GiftReportApi {
  getGiftReport: (filters: GiftReportFilters) => Promise<GiftReport>;
  getGiftBundleReport: (filters: GiftReportFilters) => Promise<GiftBundleReport>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

export function createGiftReportApi(request: ApiRequest): GiftReportApi {
  return {
    getGiftReport: (filters): Promise<GiftReport> => {
      const params = buildMarginRangeParams(filters);
      if (filters.giftSource) {
        params.set('giftSource', filters.giftSource);
      }
      return request(`/analytics/gifts?${params.toString()}`);
    },
    getGiftBundleReport: (filters) =>
      request(`/analytics/gifts/bundles?${buildMarginRangeParams(filters).toString()}`),
  };
}

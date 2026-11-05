/**
 * Gift report query hooks (#3943)
 *
 * @module features/gift-report/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { giftReportQueryKeys } from '../api/gift-report.query-keys';
import type { GiftBundleReport, GiftReport, GiftReportFilters } from '../api/gift-report.types';

export function useGiftReportQuery(
  filters: GiftReportFilters,
  options?: { enabled?: boolean }
): UseQueryResult<GiftReport> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftReportQueryKeys.report(filters),
    queryFn: () => apiClient.giftReport.getGiftReport(filters),
    enabled: options?.enabled ?? true,
  });
}

export function useGiftBundleReportQuery(
  filters: GiftReportFilters,
  options?: { enabled?: boolean }
): UseQueryResult<GiftBundleReport> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: giftReportQueryKeys.bundles(filters),
    queryFn: () => apiClient.giftReport.getGiftBundleReport(filters),
    enabled: options?.enabled,
  });
}

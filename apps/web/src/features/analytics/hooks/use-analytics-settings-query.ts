/**
 * Analytics settings query hook
 *
 * @module features/analytics/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsSettingsQueryKeys } from '../api/analytics-settings.query-keys';
import type { AnalyticsSettingsView } from '../api/analytics-settings.types';

export function useAnalyticsSettingsQuery(): UseQueryResult<AnalyticsSettingsView> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: analyticsSettingsQueryKeys.all,
    queryFn: () => apiClient.analyticsSettings.getSettings(),
  });
}

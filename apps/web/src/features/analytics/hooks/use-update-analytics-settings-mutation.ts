/**
 * Update Analytics Settings Mutation
 *
 * Persists the display-currency override, rate basis, and backfilled-tax-rate
 * Net Sales opt-in. Invalidates the settings query on success; no optimistic
 * update per `docs/frontend-architecture.md § Async UX Conventions`.
 *
 * @module features/analytics/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { analyticsSettingsQueryKeys } from '../api/analytics-settings.query-keys';
import type { UpdateAnalyticsSettingsInput } from '../api/analytics-settings.types';

export function useUpdateAnalyticsSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateAnalyticsSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.analyticsSettings.updateSettings(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: analyticsSettingsQueryKeys.all });
    },
  });
}

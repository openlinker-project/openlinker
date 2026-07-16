/**
 * Clear PostHog Credentials Mutation
 *
 * Removes the stored PostHog API key. After success the resolved config
 * falls back to the env var (if set) or reports no key configured.
 * Invalidates the settings query so the dialog/tile reflect the new state.
 *
 * @module apps/web/src/features/posthog-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { posthogSettingsQueryKeys } from '../api/posthog-settings.query-keys';

export function useClearPosthogCredentialsMutation(): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.posthogSettings.clearCredentials(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: posthogSettingsQueryKeys.all });
    },
  });
}

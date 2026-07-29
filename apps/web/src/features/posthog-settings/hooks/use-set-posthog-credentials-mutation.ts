/**
 * Set PostHog Credentials Mutation
 *
 * Persists a new PostHog API key. Write-only — the value is never echoed
 * back. Invalidates the settings query so `apiKeyConfigured` flips to `true`.
 *
 * @module apps/web/src/features/posthog-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { posthogSettingsQueryKeys } from '../api/posthog-settings.query-keys';
import type { SetPosthogCredentialsInput } from '../api/posthog-settings.types';

export function useSetPosthogCredentialsMutation(): UseMutationResult<
  void,
  Error,
  SetPosthogCredentialsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.posthogSettings.setCredentials(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: posthogSettingsQueryKeys.all });
    },
  });
}

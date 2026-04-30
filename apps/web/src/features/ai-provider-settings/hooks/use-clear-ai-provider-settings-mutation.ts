/**
 * Clear AI Provider Key Mutation
 *
 * Removes the stored API key for a specific provider. After success the
 * source falls back to `env` (if the provider's env-var is set) or `none`.
 * Invalidates the settings query so the table reflects the new state.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';
import type { AiProvider } from '../api/ai-provider-settings.types';

export interface ClearAiProviderKeyVariables {
  provider: AiProvider;
}

export function useClearAiProviderSettingsMutation(): UseMutationResult<
  void,
  Error,
  ClearAiProviderKeyVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider }) => apiClient.aiProviderSettings.clearKey(provider),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiProviderSettingsQueryKeys.all });
    },
  });
}

/**
 * Clear AI Provider Settings Mutation
 *
 * Removes the stored API key. After success the source falls back to
 * `env` (if `ANTHROPIC_API_KEY` is set) or `none`. Invalidates the
 * settings query so the status card reflects the new state.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';

export function useClearAiProviderSettingsMutation(): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.aiProviderSettings.clear(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiProviderSettingsQueryKeys.all });
    },
  });
}

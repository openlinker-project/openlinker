/**
 * Update AI Provider Settings Mutation
 *
 * Persists a new API key for the active provider. Invalidates the
 * settings query on success so the status card refetches and surfaces
 * the new `source: 'db'` resolution.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';
import type { UpdateAiProviderSettingsInput } from '../api/ai-provider-settings.types';

export function useUpdateAiProviderSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateAiProviderSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.aiProviderSettings.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiProviderSettingsQueryKeys.all });
    },
  });
}

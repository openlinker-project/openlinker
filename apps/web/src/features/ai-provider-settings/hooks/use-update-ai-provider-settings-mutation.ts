/**
 * Update AI Provider Key Mutation
 *
 * Persists a new API key for a specific provider. Invalidates the settings
 * query on success so the provider table refetches and surfaces the new
 * `source: 'db'` resolution.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';
import type {
  AiProvider,
  UpdateAiProviderKeyInput,
} from '../api/ai-provider-settings.types';

export interface UpdateAiProviderKeyVariables {
  provider: AiProvider;
  input: UpdateAiProviderKeyInput;
}

export function useUpdateAiProviderSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateAiProviderKeyVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, input }) => apiClient.aiProviderSettings.setKey(provider, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiProviderSettingsQueryKeys.all });
    },
  });
}

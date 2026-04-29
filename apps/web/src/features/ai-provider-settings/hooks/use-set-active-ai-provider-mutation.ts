/**
 * Set Active AI Provider Mutation
 *
 * Switches which provider routes future completions. Throws an `ApiError`
 * with a 422 when the target provider has no key configured (the BE
 * `AiProviderActivationError`); the form surfaces that message in an
 * `<Alert>` rather than disabling the button silently. Invalidates the
 * settings query so the active row badge moves on success.
 *
 * @module apps/web/src/features/ai-provider-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { aiProviderSettingsQueryKeys } from '../api/ai-provider-settings.query-keys';
import type { SetActiveAiProviderInput } from '../api/ai-provider-settings.types';

export function useSetActiveAiProviderMutation(): UseMutationResult<
  void,
  Error,
  SetActiveAiProviderInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.aiProviderSettings.setActive(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: aiProviderSettingsQueryKeys.all });
    },
  });
}

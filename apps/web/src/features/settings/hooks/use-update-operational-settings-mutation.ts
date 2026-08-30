/**
 * Update Operational Settings Mutation
 *
 * Persists a partial change and invalidates the settings query, so the form
 * re-reads the values WITH their new `source` rather than assuming the write
 * landed exactly as sent — the server clamps and resolves, and the page's job
 * is to show what it decided.
 *
 * @module apps/web/src/features/settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { operationalSettingsQueryKeys } from '../api/operational-settings.query-keys';
import type { UpdateOperationalSettingsInput } from '../api/operational-settings.types';

export function useUpdateOperationalSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateOperationalSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateOperationalSettingsInput) => apiClient.operationalSettings.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: operationalSettingsQueryKeys.all });
    },
  });
}

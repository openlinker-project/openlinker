/**
 * Update PostHog Settings Mutation
 *
 * Persists the non-secret enabled/region/host/autocapture/sessionRecording
 * fields. Invalidates the settings query on success so the tile + dialog
 * refetch the new state.
 *
 * @module apps/web/src/features/posthog-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { posthogSettingsQueryKeys } from '../api/posthog-settings.query-keys';
import type { UpdatePosthogSettingsInput } from '../api/posthog-settings.types';

export function useUpdatePosthogSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdatePosthogSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.posthogSettings.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: posthogSettingsQueryKeys.all });
    },
  });
}

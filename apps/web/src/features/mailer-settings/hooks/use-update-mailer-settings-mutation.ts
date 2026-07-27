/**
 * Update Mailer Settings Mutation
 *
 * Persists the non-secret transport/host/port/secure/from fields. Invalidates
 * the settings query on success so the tile + dialog refetch the new state.
 *
 * @module apps/web/src/features/mailer-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mailerSettingsQueryKeys } from '../api/mailer-settings.query-keys';
import type { UpdateMailerSettingsInput } from '../api/mailer-settings.types';

export function useUpdateMailerSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateMailerSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.mailerSettings.update(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mailerSettingsQueryKeys.all });
    },
  });
}

/**
 * Clear Mailer Credentials Mutation
 *
 * Removes the stored SMTP password. After success the resolved transport
 * config falls back to the env var (if set) or reports no password
 * configured. Invalidates the settings query so the dialog/tile reflect the
 * new state.
 *
 * @module apps/web/src/features/mailer-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mailerSettingsQueryKeys } from '../api/mailer-settings.query-keys';

export function useClearMailerCredentialsMutation(): UseMutationResult<void, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.mailerSettings.clearCredentials(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mailerSettingsQueryKeys.all });
    },
  });
}

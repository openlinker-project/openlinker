/**
 * Set Mailer Credentials Mutation
 *
 * Persists a new SMTP password. Write-only — the value is never echoed back.
 * Invalidates the settings query so `smtpPasswordConfigured` flips to `true`.
 *
 * @module apps/web/src/features/mailer-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { mailerSettingsQueryKeys } from '../api/mailer-settings.query-keys';
import type { SetMailerCredentialsInput } from '../api/mailer-settings.types';

export function useSetMailerCredentialsMutation(): UseMutationResult<
  void,
  Error,
  SetMailerCredentialsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.mailerSettings.setCredentials(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: mailerSettingsQueryKeys.all });
    },
  });
}

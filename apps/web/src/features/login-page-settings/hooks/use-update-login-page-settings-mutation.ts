/**
 * useUpdateLoginPageSettingsMutation
 *
 * Saves the login-page copy and refreshes both the settings read and the
 * public system config, which carries the same copy to the login page.
 *
 * @module features/login-page-settings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { systemQueryKeys } from '../../system';
import { loginPageSettingsQueryKeys } from '../api/login-page-settings.query-keys';
import type { UpdateLoginPageSettingsInput } from '../api/login-page-settings.types';

export function useUpdateLoginPageSettingsMutation(): UseMutationResult<
  void,
  Error,
  UpdateLoginPageSettingsInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input) => apiClient.loginPageSettings.update(input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: loginPageSettingsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: systemQueryKeys.config() }),
      ]);
    },
  });
}

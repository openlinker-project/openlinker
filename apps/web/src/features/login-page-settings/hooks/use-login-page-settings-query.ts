/**
 * useLoginPageSettingsQuery
 *
 * @module features/login-page-settings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { loginPageSettingsQueryKeys } from '../api/login-page-settings.query-keys';
import type { LoginPageSettingsView } from '../api/login-page-settings.types';

export function useLoginPageSettingsQuery(): UseQueryResult<LoginPageSettingsView> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: loginPageSettingsQueryKeys.current(),
    queryFn: () => apiClient.loginPageSettings.get(),
  });
}

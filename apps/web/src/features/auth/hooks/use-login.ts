import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import { captureDemoEvent } from '../../demo';
import type { LoginRequest, LoginResponse } from '../api/auth.types';

export function useLogin(): UseMutationResult<LoginResponse, Error, LoginRequest> {
  const apiClient = useApiClient();
  const { adapter, refreshSession } = useSession();

  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      const response = await apiClient.auth.login(input);
      await adapter.persistSession(response.access_token);
      const session = await refreshSession();
      captureDemoEvent('demo_login_succeeded', { role: session.user?.role ?? 'unknown' });
      return response;
    },
  });
}

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { useSession } from '../../../shared/auth/use-session';
import type { LoginRequest, LoginResponse } from '../api/auth.types';

export function useLogin(): UseMutationResult<LoginResponse, Error, LoginRequest> {
  const apiClient = useApiClient();
  const { adapter, refreshSession } = useSession();

  return useMutation({
    mutationFn: async (input: LoginRequest) => {
      const response = await apiClient.auth.login(input);
      await adapter.persistSession(response.access_token);
      await refreshSession();
      return response;
    },
  });
}

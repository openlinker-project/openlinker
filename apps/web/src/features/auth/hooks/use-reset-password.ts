import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { OkResponse, ResetPasswordRequest } from '../api/auth.types';

export function useResetPassword(): UseMutationResult<OkResponse, Error, ResetPasswordRequest> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input) => apiClient.auth.resetPassword(input),
  });
}

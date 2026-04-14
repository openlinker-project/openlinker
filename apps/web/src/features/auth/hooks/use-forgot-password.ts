import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ForgotPasswordRequest, OkResponse } from '../api/auth.types';

export function useForgotPassword(): UseMutationResult<OkResponse, Error, ForgotPasswordRequest> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input) => apiClient.auth.forgotPassword(input),
  });
}

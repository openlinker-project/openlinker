import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ApiError } from '../../../shared/api/api-error';
import type { OkResponse, RegisterRequest } from '../../auth';

export function useRegisterMutation(): UseMutationResult<OkResponse, ApiError, RegisterRequest> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (input: RegisterRequest) => apiClient.auth.register(input),
  });
}

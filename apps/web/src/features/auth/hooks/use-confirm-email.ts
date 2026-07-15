import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ConfirmEmailRequest, OkResponse } from '../api/auth.types';

export function useConfirmEmail(): UseMutationResult<OkResponse, Error, ConfirmEmailRequest> {
  const apiClient = useApiClient();
  return useMutation({
    mutationFn: (input) => apiClient.auth.confirmEmail(input),
  });
}

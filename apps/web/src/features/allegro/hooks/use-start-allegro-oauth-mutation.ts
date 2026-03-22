import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { StartAllegroOAuthInput, StartAllegroOAuthResponse } from '../api/allegro.api';

export function useStartAllegroOAuthMutation(): UseMutationResult<
  StartAllegroOAuthResponse,
  Error,
  StartAllegroOAuthInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (input: StartAllegroOAuthInput) => apiClient.allegro.startOAuth(input),
  });
}

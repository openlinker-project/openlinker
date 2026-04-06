import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { AllegroCallbackResponse } from '../api/allegro.api';

interface HandleCallbackInput {
  code: string;
  state: string;
}

export function useHandleAllegroCallbackMutation(): UseMutationResult<
  AllegroCallbackResponse,
  Error,
  HandleCallbackInput
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: ({ code, state }: HandleCallbackInput) =>
      apiClient.allegro.handleCallback(code, state),
  });
}

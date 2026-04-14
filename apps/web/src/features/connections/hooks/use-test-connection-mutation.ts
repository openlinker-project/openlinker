import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { ConnectionTestResult } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useTestConnectionMutation(): UseMutationResult<
  ConnectionTestResult,
  Error,
  string
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (connectionId: string) => apiClient.connections.test(connectionId),
  });
}

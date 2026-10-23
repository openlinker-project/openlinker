import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { Connection } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useRestoreConnectionMutation(): UseMutationResult<Connection, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) => apiClient.connections.restore(connectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.all,
      });
    },
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { CreateConnectionInput } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useCreateConnectionMutation() {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateConnectionInput) => apiClient.connections.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.all,
      });
    },
  });
}

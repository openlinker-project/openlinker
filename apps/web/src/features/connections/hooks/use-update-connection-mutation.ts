import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { Connection, UpdateConnectionInput } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

interface UpdateConnectionVariables {
  connectionId: string;
  input: UpdateConnectionInput;
}

export function useUpdateConnectionMutation(): UseMutationResult<Connection, Error, UpdateConnectionVariables> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, input }: UpdateConnectionVariables) =>
      apiClient.connections.update(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.all,
      });
    },
  });
}

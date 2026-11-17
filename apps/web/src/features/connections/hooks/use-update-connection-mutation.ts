import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { Connection, UpdateConnectionInput } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Stable key so other features can observe a successful connection save
 * without this hook importing them (the release center completes setup steps
 * from it, ADR-085). Only writers using this hook are observable.
 */
export const UPDATE_CONNECTION_MUTATION_KEY = ['connections', 'update'] as const;

interface UpdateConnectionVariables {
  connectionId: string;
  input: UpdateConnectionInput;
}

export function useUpdateConnectionMutation(): UseMutationResult<Connection, Error, UpdateConnectionVariables> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: UPDATE_CONNECTION_MUTATION_KEY,
    mutationFn: ({ connectionId, input }: UpdateConnectionVariables) =>
      apiClient.connections.update(connectionId, input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.all,
      });
    },
  });
}

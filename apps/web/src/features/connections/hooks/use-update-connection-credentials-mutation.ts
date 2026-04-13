import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

interface UpdateCredentialsVariables {
  connectionId: string;
  credentials: Record<string, unknown>;
}

export function useUpdateConnectionCredentialsMutation(): UseMutationResult<
  void,
  Error,
  UpdateCredentialsVariables
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, credentials }: UpdateCredentialsVariables) =>
      apiClient.connections.updateCredentials(connectionId, credentials),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
  });
}

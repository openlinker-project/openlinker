import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';

export function useDeactivateUserMutation(): UseMutationResult<void, Error, string> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) => apiClient.users.deactivate(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    },
  });
}

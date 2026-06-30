import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';
import type { UserRole } from '../api/users.types';

export function useUpdateRoleMutation(): UseMutationResult<void, Error, { userId: string; role: UserRole }> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }) => apiClient.users.updateRole(userId, { role }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    },
  });
}

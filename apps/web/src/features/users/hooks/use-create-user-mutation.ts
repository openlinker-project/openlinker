/**
 * useCreateUserMutation (#3456 / #3457)
 *
 * `POST /users` — an admin creates an account directly, typically a packer.
 *
 * The response carries the one-time password. It is returned from
 * `mutateAsync` to the caller and nowhere else: this hook sets no query data,
 * and `gcTime: 0` drops the settled mutation (which holds the response) from
 * the MutationCache as soon as nothing observes it. The caller keeps the
 * password in component state only.
 *
 * @module features/users/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';
import type { CreateUserRequest, CreateUserResponse } from '../api/users.types';

export function useCreateUserMutation(): UseMutationResult<
  CreateUserResponse,
  Error,
  CreateUserRequest
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input) => apiClient.users.create(input),
    gcTime: 0,
    onSuccess: async () => {
      // `all` covers both the admin list and the packers roster.
      await queryClient.invalidateQueries({ queryKey: usersQueryKeys.all });
    },
  });
}

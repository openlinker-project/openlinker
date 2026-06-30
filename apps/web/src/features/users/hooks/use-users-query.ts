import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';
import type { UserListFilters, UserListResponse } from '../api/users.types';

export function useUsersQuery(filters?: UserListFilters): UseQueryResult<UserListResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: usersQueryKeys.list(filters),
    queryFn: () => apiClient.users.list(filters),
  });
}

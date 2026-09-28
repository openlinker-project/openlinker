import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';
import type { PackerListResponse } from '../api/users.types';

/** The roster the Assign Packing Work screen groups into swimlanes (#3340). */
export function usePackersQuery(): UseQueryResult<PackerListResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: usersQueryKeys.packers,
    queryFn: () => apiClient.users.listPackers(),
  });
}

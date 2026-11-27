import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { usersQueryKeys } from '../api/users.query-keys';
import type { PackerListResponse } from '../api/users.types';

/**
 * The roster the Assign Packing Work screen groups into swimlanes (#3340).
 *
 * `enabled` (default `true`) lets a surface that needs names only sometimes -
 * `/orders`, for a row with an assigned pack-bench work (#3482) - skip the
 * request entirely when no row needs it.
 */
export function usePackersQuery(
  options: { enabled?: boolean } = {}
): UseQueryResult<PackerListResponse> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: usersQueryKeys.packers,
    queryFn: () => apiClient.users.listPackers(),
    enabled: options.enabled ?? true,
  });
}

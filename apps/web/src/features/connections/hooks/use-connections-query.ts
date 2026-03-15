import { useQuery } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { ConnectionFilters } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useConnectionsQuery(filters?: ConnectionFilters) {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.list(filters),
    queryFn: () => apiClient.connections.list(filters),
  });
}

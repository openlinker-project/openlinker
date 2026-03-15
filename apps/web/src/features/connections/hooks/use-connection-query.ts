import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { Connection } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useConnectionQuery(connectionId: string): UseQueryResult<Connection> {
  const apiClient = useApiClient();

  return useQuery({
    enabled: connectionId.length > 0,
    queryKey: connectionsQueryKeys.detail(connectionId),
    queryFn: () => apiClient.connections.getById(connectionId),
  });
}

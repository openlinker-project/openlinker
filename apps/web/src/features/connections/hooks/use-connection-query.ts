import { useQuery } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useConnectionQuery(connectionId: string) {
  const apiClient = useApiClient();

  return useQuery({
    enabled: connectionId.length > 0,
    queryKey: connectionsQueryKeys.detail(connectionId),
    queryFn: () => apiClient.connections.getById(connectionId),
  });
}

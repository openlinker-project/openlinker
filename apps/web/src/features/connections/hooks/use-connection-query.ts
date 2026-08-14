import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { Connection } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * `enabled` lets a composite opt the per-row fetch out when its page already
 * resolved the connection from a single batched `useConnectionsQuery()` read
 * (#1996) - the hook still runs unconditionally, so hook order is stable.
 */
export function useConnectionQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<Connection> {
  const apiClient = useApiClient();

  return useQuery({
    enabled: connectionId.length > 0 && (options?.enabled ?? true),
    queryKey: connectionsQueryKeys.detail(connectionId),
    queryFn: () => apiClient.connections.getById(connectionId),
  });
}

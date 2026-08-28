/**
 * Connection Sync Status Query Hook
 *
 * TanStack Query wrapper over `GET /connections/:id/sync-status` (#2615),
 * backing the connection detail health tab's sync panel.
 *
 * @module features/connections/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { ConnectionSyncStatus } from '../api/connections.types';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Read one connection's sync queue status
 * (`GET /connections/:id/sync-status`, #2615): queue depth, whether the queue
 * is converging, the derived backlog alert, and cursor recency.
 *
 * Applies to every connection, so there is no capability gate. Manual-refresh
 * only, like its catalog-trust sibling - a diagnostics readout, not a KPI.
 */
export function useConnectionSyncStatusQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<ConnectionSyncStatus, Error> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.syncStatus(connectionId),
    queryFn: () => apiClient.connections.getSyncStatus(connectionId),
    enabled: options?.enabled ?? true,
  });
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { ConnectionDiagnostics } from '../api/connections.types';

export function useConnectionDiagnosticsQuery(
  connectionId: string | undefined,
): UseQueryResult<ConnectionDiagnostics> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.diagnostics(connectionId ?? ''),
    queryFn: () => apiClient.connections.getDiagnostics(connectionId!),
    enabled: connectionId !== undefined && connectionId.length > 0,
    retry: false,
  });
}

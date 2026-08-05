import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { RateLimitStatus } from '../api/connections.types';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Read a connection's live, in-memory outbound rate-limit status
 * (`GET /connections/:id/rate-limit-status`, #1810). Manual-refresh only —
 * no auto-poll interval, matching the FE-001 async-UX defaults for a
 * secondary readout (not a dashboard KPI).
 */
export function useRateLimitStatusQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<RateLimitStatus, Error> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.rateLimitStatus(connectionId),
    queryFn: () => apiClient.connections.getRateLimitStatus(connectionId),
    enabled: options?.enabled ?? true,
  });
}

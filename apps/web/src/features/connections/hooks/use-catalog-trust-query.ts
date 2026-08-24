import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { CatalogTrust } from '../api/connections.types';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Read a ProductMaster connection's catalog-trust facts
 * (`GET /connections/:id/catalog-trust`, #2258): the declared capability
 * rung, delta-pass enablement, and deletion-reconcile recency.
 * Manual-refresh only — a secondary readout, not a dashboard KPI. Callers
 * gate `enabled` on the connection's `enabledCapabilities` including
 * `'ProductMaster'`; the backend 404s otherwise.
 */
export function useCatalogTrustQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<CatalogTrust, Error> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.catalogTrust(connectionId),
    queryFn: () => apiClient.connections.getCatalogTrust(connectionId),
    enabled: options?.enabled ?? true,
  });
}

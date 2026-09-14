import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ConnectionAsSourceEntry } from '../api/pricing-sync.types';

export function connectionAsSourceQueryKey(connectionId: string): readonly unknown[] {
  return ['connections', connectionId, 'pricing-sync', 'as-source'];
}

/** The source connection rollup (#3150) — "how each destination adjusts my price". */
export function useConnectionAsSourceQuery(connectionId: string): UseQueryResult<ConnectionAsSourceEntry[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionAsSourceQueryKey(connectionId),
    queryFn: () => apiClient.pricingSync.asSource(connectionId),
  });
}

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import type { ConnectionPricingSyncView } from '../api/pricing-sync.types';

export function connectionPricingSyncQueryKey(connectionId: string): readonly unknown[] {
  return ['connections', connectionId, 'pricing-sync'];
}

export function useConnectionPricingSyncQuery(
  connectionId: string,
  enabled = true,
): UseQueryResult<ConnectionPricingSyncView> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionPricingSyncQueryKey(connectionId),
    queryFn: () => apiClient.pricingSync.get(connectionId),
    enabled,
  });
}

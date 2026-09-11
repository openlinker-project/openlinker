import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { priceChangesQueryKeys } from '../api/price-changes.query-keys';
import type { PriceChangeAutoAppliedItem } from '../api/price-changes.types';

export function useAutoAppliedPriceChangesQuery(
  enabled = true,
): UseQueryResult<PriceChangeAutoAppliedItem[]> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: priceChangesQueryKeys.autoApplied(),
    queryFn: () => apiClient.priceChanges.autoApplied(),
    enabled,
  });
}

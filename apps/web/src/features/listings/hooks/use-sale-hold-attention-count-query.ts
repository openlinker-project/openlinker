/**
 * use-sale-hold-attention-count-query
 *
 * How many products deleted at the source are still on sale on at least one
 * channel (#3962) - the products list banner.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { SaleHoldAttentionCountResponse } from '../api/listings.types';

export function useSaleHoldAttentionCountQuery(): UseQueryResult<SaleHoldAttentionCountResponse> {
  const apiClient = useApiClient();
  return useQuery<SaleHoldAttentionCountResponse>({
    queryKey: listingsQueryKeys.saleHoldAttentionCount(),
    queryFn: () => apiClient.listings.getSaleHoldAttentionCount(),
    staleTime: 60_000,
  });
}

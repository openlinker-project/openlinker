/**
 * use-release-sale-holds-mutation
 *
 * "Put back on sale" for listings OpenLinker took off sale after a source
 * deletion (#3962). Refreshes the product's sale status and the products
 * list banner count on success.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { ReleaseSaleHoldsResponse } from '../api/listings.types';

export function useReleaseSaleHoldsMutation(
  productId: string,
): UseMutationResult<ReleaseSaleHoldsResponse, Error, string[]> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation<ReleaseSaleHoldsResponse, Error, string[]>({
    mutationFn: (holdIds) => apiClient.listings.releaseSaleHolds(productId, holdIds),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.productSaleStatus(productId) });
      void queryClient.invalidateQueries({ queryKey: listingsQueryKeys.saleHoldAttentionCount() });
    },
  });
}

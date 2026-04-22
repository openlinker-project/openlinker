/**
 * use-seller-policies-query
 *
 * Fetches the delivery / return / warranty / implied-warranty policies
 * configured on a marketplace connection. Server caches for 10 minutes;
 * we keep a 5-minute client-side staleTime so repeated wizard opens
 * within a session do not re-fetch.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import type { SellerPoliciesResponse } from '../api/listings.types';

export const SELLER_POLICIES_STALE_TIME_MS = 5 * 60 * 1000;

export function useSellerPoliciesQuery(
  connectionId: string,
): UseQueryResult<SellerPoliciesResponse> {
  const apiClient = useApiClient();

  return useQuery<SellerPoliciesResponse>({
    queryKey: listingsQueryKeys.sellerPolicies(connectionId),
    queryFn: () => apiClient.listings.getSellerPolicies(connectionId),
    enabled: Boolean(connectionId),
    staleTime: SELLER_POLICIES_STALE_TIME_MS,
  });
}

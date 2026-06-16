/**
 * use-shop-publish-status-query
 *
 * Polls the single shop-publish record status endpoint on a 5-second
 * interval until the record reaches a terminal status (`draft`,
 * `published`, or `failed`). On terminal status the interval is set to
 * `false` and TanStack Query stops polling. (#1044)
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import {
  TERMINAL_SHOP_PUBLISH_STATUSES,
  type ShopPublishStatusResponse,
} from '../api/listings.types';

export const SHOP_PUBLISH_POLL_INTERVAL_MS = 5_000;

export function useShopPublishStatusQuery(
  connectionId: string,
  recordId: string,
): UseQueryResult<ShopPublishStatusResponse> {
  const apiClient = useApiClient();

  return useQuery<ShopPublishStatusResponse>({
    queryKey: listingsQueryKeys.shopPublishStatus(connectionId, recordId),
    queryFn: () => apiClient.listings.getShopPublishStatus(connectionId, recordId),
    enabled: Boolean(connectionId && recordId),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_SHOP_PUBLISH_STATUSES.includes(status)) {
        return false;
      }
      return SHOP_PUBLISH_POLL_INTERVAL_MS;
    },
  });
}

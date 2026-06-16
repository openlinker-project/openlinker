/**
 * use-bulk-shop-publish-batch-query
 *
 * Polls the bulk shop-publish batch status endpoint on a 5-second interval
 * until the batch reaches a terminal status (`completed`,
 * `partially-failed`, or `failed`). On terminal status the interval is set
 * to `false` and TanStack Query stops polling. (#1044)
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import {
  TERMINAL_BULK_SHOP_PUBLISH_STATUSES,
  type BulkShopPublishBatchResponse,
} from '../api/listings.types';

export const BULK_SHOP_PUBLISH_POLL_INTERVAL_MS = 5_000;

export function useBulkShopPublishBatchQuery(
  batchId: string,
): UseQueryResult<BulkShopPublishBatchResponse> {
  const apiClient = useApiClient();

  return useQuery<BulkShopPublishBatchResponse>({
    queryKey: listingsQueryKeys.bulkShopPublishBatch(batchId),
    queryFn: () => apiClient.listings.getBulkShopPublishBatch(batchId),
    enabled: Boolean(batchId),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_BULK_SHOP_PUBLISH_STATUSES.includes(status)) {
        return false;
      }
      return BULK_SHOP_PUBLISH_POLL_INTERVAL_MS;
    },
  });
}

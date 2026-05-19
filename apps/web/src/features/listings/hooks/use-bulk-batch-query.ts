/**
 * use-bulk-batch-query
 *
 * Polls `GET /listings/bulk-create/:batchId` every 5 s while the batch is
 * non-terminal, stops polling once status ∈ {completed, partially-failed,
 * failed}. Mirrors the pattern in `use-offer-creation-status-query.ts`.
 *
 * @module apps/web/src/features/listings/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { listingsQueryKeys } from '../api/listings.query-keys';
import {
  TERMINAL_BULK_BATCH_STATUSES,
  type BulkBatchSummary,
} from '../api/bulk-listings.types';

export const BULK_BATCH_POLL_INTERVAL_MS = 5_000;

export function useBulkBatchQuery(
  batchId: string | undefined,
): UseQueryResult<BulkBatchSummary> {
  const apiClient = useApiClient();

  return useQuery<BulkBatchSummary>({
    queryKey: listingsQueryKeys.bulkBatch(batchId ?? ''),
    queryFn: () => apiClient.listings.getBulkBatch(batchId as string),
    enabled: Boolean(batchId),
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && TERMINAL_BULK_BATCH_STATUSES.includes(status)) {
        return false;
      }
      return BULK_BATCH_POLL_INTERVAL_MS;
    },
  });
}

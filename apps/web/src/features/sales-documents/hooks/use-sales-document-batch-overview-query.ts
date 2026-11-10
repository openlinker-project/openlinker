/**
 * useSalesDocumentBatchOverviewQuery (#3584)
 *
 * A connection's batch schedules, next slots, queue counts and the run in
 * progress. Polls every 5 s while a run is in progress so the running view
 * advances without a reload, and stops as soon as none is.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { BatchOverview } from '../api/sales-document-batch.types';

export const BATCH_RUNNING_POLL_MS = 5000;

export function useSalesDocumentBatchOverviewQuery(
  connectionId: string,
  options?: { pollWhileWaiting?: boolean }
): UseQueryResult<BatchOverview> {
  const pollWhileWaiting = options?.pollWhileWaiting ?? false;
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentBatchQueryKeys.overview(connectionId),
    queryFn: () => apiClient.salesDocumentBatch.getOverview(connectionId),
    enabled: connectionId.length > 0,
    refetchInterval: (query) =>
      query.state.data?.runningRun || pollWhileWaiting ? BATCH_RUNNING_POLL_MS : false,
  });
}

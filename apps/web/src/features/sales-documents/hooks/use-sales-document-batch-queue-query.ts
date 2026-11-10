/**
 * useSalesDocumentBatchQueueQuery (#3584)
 *
 * The orders waiting for the next batch run. Reads every page up to
 * {@link BATCH_QUEUE_FETCH_CAP} so the kind and blocked chips can filter
 * locally (M15 note 7, like the orders table); the overview's counts are the
 * total, so a larger queue is shown as "N of M" rather than silently cut.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { BatchQueueEntry } from '../api/sales-document-batch.types';

export const BATCH_QUEUE_FETCH_CAP = 1000;
const PAGE_SIZE = 200;

export function useSalesDocumentBatchQueueQuery(
  connectionId: string,
  options?: { refetchInterval?: number | false }
): UseQueryResult<BatchQueueEntry[]> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentBatchQueryKeys.queue(connectionId),
    enabled: connectionId.length > 0,
    refetchInterval: options?.refetchInterval ?? false,
    queryFn: async () => {
      const entries: BatchQueueEntry[] = [];
      let after: string | undefined;
      while (entries.length < BATCH_QUEUE_FETCH_CAP) {
        const page = await apiClient.salesDocumentBatch.getQueue(connectionId, after, PAGE_SIZE);
        entries.push(...page.items);
        if (page.nextCursor === null) break;
        after = page.nextCursor;
      }
      return entries.slice(0, BATCH_QUEUE_FETCH_CAP);
    },
  });
}

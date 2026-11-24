/**
 * useSalesDocumentBatchRunsQuery (#3584)
 *
 * The connection's recent batch runs, newest first.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { BatchRunList } from '../api/sales-document-batch.types';

export const BATCH_RUN_HISTORY_LIMIT = 20;

export function useSalesDocumentBatchRunsQuery(
  connectionId: string,
  options?: { refetchInterval?: number | false }
): UseQueryResult<BatchRunList> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentBatchQueryKeys.runs(connectionId),
    queryFn: () => apiClient.salesDocumentBatch.listRuns(connectionId, BATCH_RUN_HISTORY_LIMIT),
    enabled: connectionId.length > 0,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

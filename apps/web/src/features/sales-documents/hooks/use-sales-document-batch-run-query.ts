/**
 * useSalesDocumentBatchRunQuery (#3584)
 *
 * One run with each order's outcome, read from its documents now. Disabled
 * until a run is chosen.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { BatchRunDetail } from '../api/sales-document-batch.types';

export function useSalesDocumentBatchRunQuery(
  connectionId: string,
  runId: string | null,
  options?: { refetchInterval?: number | false }
): UseQueryResult<BatchRunDetail> {
  const apiClient = useApiClient();
  return useQuery({
    queryKey: salesDocumentBatchQueryKeys.run(connectionId, runId ?? ''),
    queryFn: () => apiClient.salesDocumentBatch.getRun(connectionId, runId ?? ''),
    enabled: connectionId.length > 0 && runId !== null,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

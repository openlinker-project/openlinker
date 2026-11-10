/**
 * useStartSalesDocumentBatchRunMutation (#3584)
 *
 * "Run now": enqueues the same run job a scheduled slot does (#3583). The run
 * row appears when the worker picks the job up, so the connection's batch
 * queries are invalidated and the overview's poll takes over from there.
 *
 * @module apps/web/src/features/sales-documents/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { salesDocumentBatchQueryKeys } from '../api/sales-document-batch.query-keys';
import type { StartBatchRunResponse } from '../api/sales-document-batch.types';

export function useStartSalesDocumentBatchRunMutation(
  connectionId: string
): UseMutationResult<StartBatchRunResponse, Error, void> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiClient.salesDocumentBatch.startRun(connectionId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: salesDocumentBatchQueryKeys.connection(connectionId),
      });
    },
  });
}

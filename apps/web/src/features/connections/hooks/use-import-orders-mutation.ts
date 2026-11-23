import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { OrderImportRequest, OrderImportStarted } from '../api/connections.types';
import { syncJobsQueryKeys } from '../../sync-jobs';

interface ImportOrdersInput {
  connectionId: string;
  request: OrderImportRequest;
}

/**
 * Start a one-off import of a past period of orders (#4228). The sync-status
 * read and the job lists are invalidated so the panel shows the run at once.
 */
export function useImportOrdersMutation(): UseMutationResult<
  OrderImportStarted,
  Error,
  ImportOrdersInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, request }: ImportOrdersInput) =>
      apiClient.connections.importOrders(connectionId, request),
    onSuccess: async (_result, { connectionId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.syncStatus(connectionId) }),
        queryClient.invalidateQueries({ queryKey: syncJobsQueryKeys.all }),
      ]);
    },
  });
}

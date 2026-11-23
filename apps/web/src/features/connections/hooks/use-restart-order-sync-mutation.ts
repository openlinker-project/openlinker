import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import type { OrderSyncStart, RestartOrderSyncResult } from '../api/connections.types';

interface RestartOrderSyncInput {
  connectionId: string;
  start: OrderSyncStart;
}

/**
 * Restart a connection's order sync from a new start (#4228). The sync-status
 * read is invalidated so the Order sync panel drops the old start date.
 */
export function useRestartOrderSyncMutation(): UseMutationResult<
  RestartOrderSyncResult,
  Error,
  RestartOrderSyncInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, start }: RestartOrderSyncInput) =>
      apiClient.connections.restartOrderSync(connectionId, start),
    onSuccess: async (_result, { connectionId }) => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.syncStatus(connectionId),
      });
    },
  });
}

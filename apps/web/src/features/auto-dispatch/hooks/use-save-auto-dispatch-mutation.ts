/**
 * Save the automatic-label settings (#2729)
 *
 * `PATCH /connections/:id` replaces `config` whole, so the write is built from a
 * config read at the moment of saving, with only the `autoDispatch` key changed.
 * Building it from the copy the page loaded earlier would silently undo anything
 * another tab changed in between (the packing claims in particular).
 *
 * @module apps/web/src/features/auto-dispatch/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys, type Connection } from '../../connections';
import { autoDispatchQueryKeys } from '../api/auto-dispatch.query-keys';
import { withAutoDispatch, type AutoDispatchSettings } from '../lib/auto-dispatch-config';

export interface SaveAutoDispatchInput {
  readonly connectionId: string;
  readonly settings: AutoDispatchSettings;
}

export function useSaveAutoDispatchMutation(): UseMutationResult<
  Connection,
  Error,
  SaveAutoDispatchInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ connectionId, settings }) => {
      const fresh = await apiClient.connections.getById(connectionId);
      return apiClient.connections.update(connectionId, {
        config: withAutoDispatch(fresh.config, settings),
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: autoDispatchQueryKeys.all }),
      ]);
    },
  });
}

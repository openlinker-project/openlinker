/**
 * Declare a setup step not needed, or undo that (#3457)
 *
 * Writes `setupSkipped` on the OMS connection on a freshly read config, since
 * `PATCH` replaces `config` whole and a stale copy would drop whatever changed
 * in between (the sourcing claims, the stock override).
 *
 * @module features/oms-onboarding/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys, type Connection } from '../../connections';
import { withSetupSkipped, type SetupStepKey } from '../lib/setup-steps';

export interface SetSetupStepSkippedInput {
  readonly packingConnectionId: string;
  readonly step: SetupStepKey;
  readonly skipped: boolean;
}

export function useSetSetupStepSkippedMutation(): UseMutationResult<
  Connection,
  Error,
  SetSetupStepSkippedInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ packingConnectionId, step, skipped }) => {
      const fresh = await apiClient.connections.getById(packingConnectionId);
      return apiClient.connections.update(packingConnectionId, {
        config: withSetupSkipped(fresh.config, step, skipped),
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
  });
}

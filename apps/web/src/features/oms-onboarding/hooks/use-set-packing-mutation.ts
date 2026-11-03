/**
 * Turn packing on or off (#3457, step 4 and the status page)
 *
 * Writes the packing connection's two authority claims (sourcing and
 * executor) on a freshly read config
 * (`PATCH` replaces `config` whole). The claim is always written as an object
 * so a stop KEEPS it and its scopes — together with the warehouse and every
 * product master's stock override, which this never touches — and a restart
 * is one click.
 *
 * The backend refuses the off → on transition while no active warehouse
 * exists (#2407); the caller maps that refusal with
 * `isRoutingRequiresLocationError`.
 *
 * @module features/oms-onboarding/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys, type Connection } from '../../connections';
import { whoDecidesQueryKeys } from '../../fulfillment-authority';
import { withPackingClaimsEnabled } from '../lib/config-merge';

export interface SetPackingInput {
  readonly packingConnectionId: string;
  readonly enabled: boolean;
}

export function useSetPackingMutation(): UseMutationResult<Connection, Error, SetPackingInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ packingConnectionId, enabled }) => {
      const fresh = await apiClient.connections.getById(packingConnectionId);
      return apiClient.connections.update(packingConnectionId, {
        config: withPackingClaimsEnabled(fresh.config, enabled),
      });
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all }),
        queryClient.invalidateQueries({ queryKey: whoDecidesQueryKeys.all }),
      ]);
    },
  });
}

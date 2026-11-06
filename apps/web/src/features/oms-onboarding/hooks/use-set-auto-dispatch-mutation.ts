/**
 * Save the label defaults, or switch buying labels on or off (#3958)
 *
 * Writes `config.autoDispatch` on the OMS connection, which is where the
 * worker reads it when a packer accepts a parcel. `PATCH` replaces `config`
 * whole, so the config is read fresh first and only this one key changes.
 *
 * Switching off keeps the size, box and weight: the operator's choice is to
 * stop buying, not to forget how to buy, and turning it back on should not
 * mean typing them again.
 *
 * @module features/oms-onboarding/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys, type Connection } from '../../connections';
import { readAutoDispatch, withAutoDispatch, type AutoDispatchSettings } from '../lib/config-merge';

export type SetAutoDispatchInput =
  | {
      readonly kind: 'save';
      readonly packingConnectionId: string;
      readonly settings: AutoDispatchSettings;
    }
  | {
      readonly kind: 'setEnabled';
      readonly packingConnectionId: string;
      readonly enabled: boolean;
    };

export function useSetAutoDispatchMutation(): UseMutationResult<Connection, Error, SetAutoDispatchInput> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const fresh = await apiClient.connections.getById(input.packingConnectionId);
      const settings =
        input.kind === 'save'
          ? input.settings
          : { ...(readAutoDispatch(fresh.config) ?? {}), enabled: input.enabled };
      return apiClient.connections.update(input.packingConnectionId, {
        config: withAutoDispatch(fresh.config, settings),
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
  });
}

/**
 * Set Buyer Emails Enabled Mutation (#3555)
 *
 * The connection-level master switch on the buyer emails list. `PATCH
 * /connections/:id` replaces `config` wholesale, so the config is RE-READ
 * immediately before the write instead of taken from the list's cache - a
 * cached copy would silently undo any other key changed since the list loaded
 * (the #2016 shallow-spread hazard). A write racing inside the remaining
 * read-to-write gap is still last-write-wins.
 *
 * @module apps/web/src/features/buyer-emails/hooks
 */
import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys, type Connection } from '../../connections';
import { useApiClient } from '../../../app/api/api-client-provider';
import { readBuyerEmailsSettings, withBuyerEmailsSettings } from '../lib/buyer-emails-config';

export interface SetBuyerEmailsEnabledInput {
  connectionId: string;
  enabled: boolean;
}

export function useSetBuyerEmailsEnabledMutation(): UseMutationResult<
  Connection,
  Error,
  SetBuyerEmailsEnabledInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      connectionId,
      enabled,
    }: SetBuyerEmailsEnabledInput): Promise<Connection> => {
      const { config } = await apiClient.connections.getById(connectionId);
      const settings = readBuyerEmailsSettings(config);
      return apiClient.connections.update(connectionId, {
        config: withBuyerEmailsSettings(config, { ...settings, enabled }),
      });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: connectionsQueryKeys.all });
    },
  });
}

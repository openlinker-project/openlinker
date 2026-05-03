import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import type { InstallWebhooksResult } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';
import { connectionsQueryKeys } from '../api/connections.query-keys';

/**
 * Configure webhooks (#168) — admin click that pushes Base URL / Connection ID /
 * Webhook Secret to the PS `openlinker` module via PS WS, then triggers a
 * synchronous test ping. Connection cache is invalidated on success so the
 * `webhooksConfigured` flag and recent webhook deliveries refresh.
 */
export function useConfigureWebhooksMutation(): UseMutationResult<
  InstallWebhooksResult,
  Error,
  string
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (connectionId: string) => apiClient.connections.installWebhooks(connectionId),
    onSuccess: async (_result, connectionId) => {
      await queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.detail(connectionId),
      });
    },
  });
}

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

interface SetWebhookSecretInput {
  connectionId: string;
  secret: string;
}

/**
 * Set a caller-supplied webhook signing secret for a connection
 * (`PUT /connections/:id/webhooks/secret`, #1770). Used where the external
 * platform mints the secret and the operator pastes it into OpenLinker
 * (inFakt). Distinct from the rotate flow. Invalidates the webhook-status
 * query so the signature state refreshes.
 */
export function useSetWebhookSecretMutation(): UseMutationResult<
  void,
  Error,
  SetWebhookSecretInput
> {
  const apiClient = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ connectionId, secret }: SetWebhookSecretInput) =>
      apiClient.connections.setWebhookSecret(connectionId, secret),
    onSuccess: (_data, { connectionId }) => {
      void queryClient.invalidateQueries({
        queryKey: connectionsQueryKeys.webhookStatus(connectionId),
      });
    },
  });
}

import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import type { RotateWebhookSecretResult } from '../api/connections.types';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Rotate the OpenLinker webhook HMAC secret for a connection
 * (`POST /connections/:id/webhooks/secret/rotate`). Used by the manual webhook
 * runbooks (e.g. InPost, #1473) where the operator must configure the same
 * secret on the source platform so signed deliveries verify.
 *
 * The plaintext secret is revealed exactly once in the response, so the caller
 * must surface it immediately. No cache invalidation — the secret is never read
 * back, only generated.
 */
export function useRotateWebhookSecretMutation(): UseMutationResult<
  RotateWebhookSecretResult,
  Error,
  string
> {
  const apiClient = useApiClient();

  return useMutation({
    mutationFn: (connectionId: string) => apiClient.connections.rotateWebhookSecret(connectionId),
  });
}

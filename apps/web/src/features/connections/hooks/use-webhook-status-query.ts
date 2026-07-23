import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { WebhookStatus } from '../api/connections.types';
import { connectionsQueryKeys } from '../api/connections.query-keys';
import { useApiClient } from '../../../app/api/api-client-provider';

/**
 * Read a connection's inbound-webhook status (`GET
 * /connections/:id/webhooks/status`, #1770): activation, signature
 * configuration, and the latest delivery summary. Backs the inFakt
 * webhook-config modal's status strip.
 */
export function useWebhookStatusQuery(
  connectionId: string,
  options?: { enabled?: boolean },
): UseQueryResult<WebhookStatus, Error> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: connectionsQueryKeys.webhookStatus(connectionId),
    queryFn: () => apiClient.connections.getWebhookStatus(connectionId),
    enabled: options?.enabled ?? true,
  });
}

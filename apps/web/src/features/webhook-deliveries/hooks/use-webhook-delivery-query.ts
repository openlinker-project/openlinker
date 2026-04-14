import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { webhookDeliveriesQueryKeys } from '../api/webhook-deliveries.query-keys';
import type { WebhookDeliveryDetail } from '../api/webhook-deliveries.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useWebhookDeliveryQuery(
  id: string | undefined,
): UseQueryResult<WebhookDeliveryDetail> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: webhookDeliveriesQueryKeys.detail(id ?? ''),
    queryFn: () => apiClient.webhookDeliveries.getById(id ?? ''),
    enabled: Boolean(id),
    retry: false,
  });
}

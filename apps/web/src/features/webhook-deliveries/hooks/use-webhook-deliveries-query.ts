import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { webhookDeliveriesQueryKeys } from '../api/webhook-deliveries.query-keys';
import type {
  PaginatedWebhookDeliveries,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
} from '../api/webhook-deliveries.types';
import { useApiClient } from '../../../app/api/api-client-provider';

export function useWebhookDeliveriesQuery(
  filters?: WebhookDeliveryFilters,
  pagination?: WebhookDeliveryPagination,
): UseQueryResult<PaginatedWebhookDeliveries> {
  const apiClient = useApiClient();

  return useQuery({
    queryKey: webhookDeliveriesQueryKeys.list(filters, pagination),
    queryFn: () => apiClient.webhookDeliveries.list(filters, pagination),
    retry: false,
  });
}

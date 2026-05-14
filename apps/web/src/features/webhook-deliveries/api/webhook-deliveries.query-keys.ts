import type { WebhookDeliveryFilters, WebhookDeliveryPagination } from './webhook-deliveries.types';

export const webhookDeliveriesQueryKeys = {
  all: ['webhook-deliveries'] as const,
  list: (filters?: WebhookDeliveryFilters, pagination?: WebhookDeliveryPagination) =>
    ['webhook-deliveries', 'list', filters ?? {}, pagination ?? {}] as const,
  detail: (id: string) => ['webhook-deliveries', 'detail', id] as const,
};

/**
 * Webhook Delivery Query Service Interface
 *
 * @module apps/api/src/webhooks/application/interfaces
 */
import type {
  PaginatedWebhookDeliveries,
  WebhookDelivery,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
} from '@openlinker/core/webhooks';

export const WEBHOOK_DELIVERY_QUERY_SERVICE_TOKEN = Symbol('IWebhookDeliveryQueryService');

export interface IWebhookDeliveryQueryService {
  list(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination,
  ): Promise<PaginatedWebhookDeliveries>;
  getById(id: string): Promise<WebhookDelivery | null>;
}

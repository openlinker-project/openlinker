/**
 * Webhook Deliveries API Client
 *
 * Typed client for GET /webhook-deliveries endpoints.
 *
 * @module apps/web/src/features/webhook-deliveries/api
 */
import type {
  PaginatedWebhookDeliveries,
  WebhookDeliveryDetail,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
} from './webhook-deliveries.types';

export interface WebhookDeliveriesApi {
  list: (
    filters?: WebhookDeliveryFilters,
    pagination?: WebhookDeliveryPagination,
  ) => Promise<PaginatedWebhookDeliveries>;
  getById: (id: string) => Promise<WebhookDeliveryDetail>;
}

interface ApiRequest {
  <T>(path: string, init?: RequestInit): Promise<T>;
}

function buildQuery(
  filters?: WebhookDeliveryFilters,
  pagination?: WebhookDeliveryPagination,
): string {
  const params = new URLSearchParams();
  if (filters?.provider) params.set('provider', filters.provider);
  if (filters?.connectionId) params.set('connectionId', filters.connectionId);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.since) params.set('since', filters.since);
  if (filters?.until) params.set('until', filters.until);
  if (pagination?.limit !== undefined) params.set('limit', String(pagination.limit));
  if (pagination?.offset !== undefined) params.set('offset', String(pagination.offset));
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : '';
}

export function createWebhookDeliveriesApi(request: ApiRequest): WebhookDeliveriesApi {
  return {
    list(filters, pagination): Promise<PaginatedWebhookDeliveries> {
      return request<PaginatedWebhookDeliveries>(
        `/webhook-deliveries${buildQuery(filters, pagination)}`,
      );
    },
    getById(id): Promise<WebhookDeliveryDetail> {
      return request<WebhookDeliveryDetail>(`/webhook-deliveries/${id}`);
    },
  };
}

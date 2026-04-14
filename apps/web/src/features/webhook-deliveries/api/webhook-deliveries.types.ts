/**
 * Webhook Deliveries Feature Types
 *
 * Transport types for the webhook delivery visibility API. Dates are ISO 8601.
 *
 * @module apps/web/src/features/webhook-deliveries/api
 */

export const WEBHOOK_DELIVERY_STATUS_VALUES = [
  'received',
  'rejected',
  'published',
  'failed',
  'job_enqueued',
  'deadlettered',
] as const;
export type WebhookDeliveryStatus = (typeof WEBHOOK_DELIVERY_STATUS_VALUES)[number];

export interface WebhookDeliverySummary {
  id: string;
  eventId: string;
  provider: string;
  connectionId: string;
  eventType: string | null;
  objectType: string | null;
  externalId: string | null;
  receivedAt: string;
  signatureValid: boolean | null;
  dedupResult: string | null;
  status: WebhookDeliveryStatus;
  rejectionReason: string | null;
  publishedMessageId: string | null;
  downstreamJobId: string | null;
  downstreamJobType: string | null;
  dlqReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDeliveryDetail extends WebhookDeliverySummary {
  payload: Record<string, unknown> | null;
}

export interface WebhookDeliveryFilters {
  provider?: string;
  connectionId?: string;
  status?: WebhookDeliveryStatus;
  since?: string;
  until?: string;
}

export interface WebhookDeliveryPagination {
  limit?: number;
  offset?: number;
}

export interface PaginatedWebhookDeliveries {
  items: WebhookDeliverySummary[];
  total: number;
  limit: number;
  offset: number;
}

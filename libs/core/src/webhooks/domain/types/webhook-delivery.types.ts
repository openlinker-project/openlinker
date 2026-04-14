/**
 * Webhook Delivery Types
 *
 * Domain types for inbound webhook delivery records. Used by the visibility
 * API to expose webhook processing outcomes to operators.
 *
 * @module libs/core/src/webhooks/domain/types
 */
import type { WebhookDelivery } from '../entities/webhook-delivery.entity';

export const WebhookDeliveryStatusValues = [
  'received',
  'rejected',
  'published',
  'failed',
  'job_enqueued',
  'deadlettered',
] as const;
export type WebhookDeliveryStatus = (typeof WebhookDeliveryStatusValues)[number];

export const WebhookDedupResultValues = ['new', 'duplicate'] as const;
export type WebhookDedupResult = (typeof WebhookDedupResultValues)[number];

export interface WebhookDeliveryFilters {
  provider?: string;
  connectionId?: string;
  status?: WebhookDeliveryStatus;
  since?: Date;
  until?: Date;
}

export interface WebhookDeliveryPagination {
  limit: number;
  offset: number;
}

export interface PaginatedWebhookDeliveries {
  items: WebhookDelivery[];
  total: number;
}

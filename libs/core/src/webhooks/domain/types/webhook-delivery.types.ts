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

/**
 * Lifecycle precedence of a delivery status.
 *
 * The ingress API and the stream consumer stamp the same row without any
 * ordering guarantee between them (#1916), so persistence resolves a conflict
 * by rank instead of by arrival: `received` -> `published` -> `job_enqueued`,
 * with the attention-worthy terminal states sharing the top rank so a later
 * `published` can never clear a dead-letter.
 *
 * Consumed by `WebhookDeliveryRepository.upsert` to build its conflict guard -
 * the ladder lives here so it cannot drift from the status union it ranks.
 */
export const WEBHOOK_DELIVERY_STATUS_RANK: Record<WebhookDeliveryStatus, number> = {
  received: 0,
  published: 1,
  job_enqueued: 2,
  rejected: 3,
  failed: 3,
  deadlettered: 3,
};

export const WebhookDedupResultValues = ['new', 'duplicate'] as const;
export type WebhookDedupResult = (typeof WebhookDedupResultValues)[number];

export interface WebhookDeliveryFilters {
  provider?: string;
  connectionId?: string;
  eventType?: string;
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

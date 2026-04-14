/**
 * Webhook Delivery Repository Port
 *
 * Persistence contract for inbound webhook delivery records. Supports upsert
 * semantics keyed on (provider, connectionId, eventId) to handle race between
 * the ingress service and the async job-linkage handler.
 *
 * @module libs/core/src/webhooks/domain/ports
 */
import { WebhookDelivery } from '../entities/webhook-delivery.entity';
import {
  PaginatedWebhookDeliveries,
  WebhookDeliveryFilters,
  WebhookDeliveryPagination,
  WebhookDeliveryStatus,
  WebhookDedupResult,
} from '../types/webhook-delivery.types';

export interface WebhookDeliveryUpsertInput {
  eventId: string;
  provider: string;
  connectionId: string;
  eventType?: string | null;
  objectType?: string | null;
  externalId?: string | null;
  receivedAt?: Date;
  signatureValid?: boolean | null;
  dedupResult?: WebhookDedupResult | null;
  status?: WebhookDeliveryStatus;
  rejectionReason?: string | null;
  publishedMessageId?: string | null;
  downstreamJobId?: string | null;
  downstreamJobType?: string | null;
  dlqReason?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface WebhookDeliveryRepositoryPort {
  upsert(input: WebhookDeliveryUpsertInput): Promise<WebhookDelivery>;
  findById(id: string): Promise<WebhookDelivery | null>;
  findMany(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination,
  ): Promise<PaginatedWebhookDeliveries>;
}

export const WEBHOOK_DELIVERY_REPOSITORY_TOKEN = Symbol(
  'WebhookDeliveryRepositoryPort',
);

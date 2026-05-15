/**
 * Webhook Delivery Repository Port
 *
 * Persistence contract for inbound webhook delivery records. Supports upsert
 * semantics keyed on (provider, connectionId, eventId) to handle race between
 * the ingress service and the async job-linkage handler.
 *
 * @module libs/core/src/webhooks/domain/ports
 */
import type { WebhookDelivery } from '../entities/webhook-delivery.entity';
import type {
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

export type WebhookDeliveryInsertResult =
  | { isNew: true; delivery: WebhookDelivery }
  | { isNew: false; existing: WebhookDelivery };

export interface WebhookDeliveryRepositoryPort {
  upsert(input: WebhookDeliveryUpsertInput): Promise<WebhookDelivery>;

  /**
   * Authoritative dedup gate (#711). Attempts to insert a new webhook-delivery
   * row keyed on `(provider, connectionId, eventId)`. Returns `{ isNew: false }`
   * if the row already exists — the caller treats this as a replay and
   * short-circuits to a 202 idempotent ack. Backed by the `uq_webhook_deliveries_event_key`
   * unique constraint on `webhook_deliveries`.
   */
  insertIfNew(input: WebhookDeliveryUpsertInput): Promise<WebhookDeliveryInsertResult>;

  /**
   * Deletes a webhook-delivery row by event-key (#711). Called when downstream
   * publishing fails after `insertIfNew` succeeded — the deletion allows the
   * source's retry to re-enter the dedup gate cleanly. Mirrors the
   * `clearProcessing` semantics of the Redis-side dedup service.
   *
   * No-op if the row doesn't exist.
   */
  deleteByEventKey(provider: string, connectionId: string, eventId: string): Promise<void>;

  findById(id: string): Promise<WebhookDelivery | null>;
  findMany(
    filters: WebhookDeliveryFilters,
    pagination: WebhookDeliveryPagination
  ): Promise<PaginatedWebhookDeliveries>;
}

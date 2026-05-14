/**
 * Webhook Delivery Domain Entity
 *
 * Represents an inbound webhook delivery record used for operator visibility
 * into signature validation, dedup, publishing, and downstream job linkage.
 * Framework-agnostic.
 *
 * @module libs/core/src/webhooks/domain/entities
 */
import type { WebhookDedupResult, WebhookDeliveryStatus } from '../types/webhook-delivery.types';

export class WebhookDelivery {
  constructor(
    public readonly id: string,
    public readonly eventId: string,
    public readonly provider: string,
    public readonly connectionId: string,
    public readonly eventType: string | null,
    public readonly objectType: string | null,
    public readonly externalId: string | null,
    public readonly receivedAt: Date,
    public readonly signatureValid: boolean | null,
    public readonly dedupResult: WebhookDedupResult | null,
    public readonly status: WebhookDeliveryStatus,
    public readonly rejectionReason: string | null,
    public readonly publishedMessageId: string | null,
    public readonly downstreamJobId: string | null,
    public readonly downstreamJobType: string | null,
    public readonly dlqReason: string | null,
    public readonly payload: Record<string, unknown> | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}

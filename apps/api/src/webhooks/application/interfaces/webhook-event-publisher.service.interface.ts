/**
 * Webhook Event Publisher Service Interface
 *
 * Defines the contract for publishing inbound webhook events to the event bus.
 * Implemented by WebhookEventPublisher to publish events to Redis Streams
 * via the EventPublisherPort.
 *
 * @module apps/api/src/webhooks/application/interfaces
 * @see {@link WebhookEventPublisher} for the implementation
 */
import { InboundWebhookEvent } from '@openlinker/core/events/domain/types/inbound-webhook-event.types';

export interface IWebhookEventPublisher {
  /**
   * Publish an inbound webhook event to the event bus
   *
   * Maps the webhook request and route parameters into an InboundWebhookEvent
   * and publishes it to the event bus (Redis Streams).
   *
   * @param event - The inbound webhook event to publish
   * @returns Promise resolving to the message ID assigned by the event bus
   * @throws Error if publishing fails
   */
  publishInboundWebhook(event: InboundWebhookEvent): Promise<string>;
}





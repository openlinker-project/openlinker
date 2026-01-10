/**
 * Webhook Event Publisher Service
 *
 * Implements publishing of inbound webhook events to the event bus (Redis Streams).
 * Maps webhook requests into InboundWebhookEvent format and publishes via
 * EventPublisherPort. Enforces payload size limits and ensures all fields are
 * string-serializable for Redis Streams compatibility.
 *
 * @module apps/api/src/webhooks/application/services
 * @implements {IWebhookEventPublisher}
 */
import { Injectable, Inject } from '@nestjs/common';
import { EventPublisherPort } from '@openlinker/core/events';
import { EVENT_PUBLISHER_TOKEN } from '@openlinker/core/events';
import { EventEnvelope, InboundWebhookEvent } from '@openlinker/core/events';
import { IWebhookEventPublisher } from '../interfaces/webhook-event-publisher.service.interface';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class WebhookEventPublisher implements IWebhookEventPublisher {
  private readonly logger = new Logger(WebhookEventPublisher.name);
  private readonly STREAM_NAME = 'events.inbound.webhooks';
  private readonly MAX_PAYLOAD_SIZE = 256 * 1024; // 256KB
  private readonly SCHEMA_VERSION = '1';

  constructor(
    @Inject(EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: EventPublisherPort,
  ) {}

  async publishInboundWebhook(event: InboundWebhookEvent): Promise<string> {
    try {
      // Validate payload size
      const payloadJson = JSON.stringify(event.payload || {});
      if (payloadJson.length > this.MAX_PAYLOAD_SIZE) {
        throw new Error(
          `Event payload exceeds maximum size of ${this.MAX_PAYLOAD_SIZE} bytes. ` +
            `Actual size: ${payloadJson.length} bytes`,
        );
      }

      // Build metadata with schemaVersion
      const metadata = {
        schemaVersion: this.SCHEMA_VERSION,
        provider: event.provider,
        connectionId: event.connectionId,
      };
      const metadataJson = JSON.stringify(metadata);

      // Build payload JSON with objectType and externalId for handler mapping
      const enrichedPayload = {
        objectType: event.objectType,
        externalId: event.externalId,
        payload: event.payload || {},
      };
      const enrichedPayloadJson = JSON.stringify(enrichedPayload);

      // Build event envelope
      // All fields must be strings for Redis Streams compatibility
      const envelope: EventEnvelope = {
        eventId: event.eventId,
        eventType: `inbound.webhook.${event.eventType}`, // Namespace event type
        payloadJson: enrichedPayloadJson, // Always a string, includes objectType and externalId
        metadataJson: metadataJson,
        occurredAt: event.occurredAt, // ISO 8601 string
        publishedAt: new Date().toISOString(), // ISO 8601 string
      };

      // Publish to event bus
      const messageId = await this.eventPublisher.publish(this.STREAM_NAME, envelope);

      this.logger.log(
        `Published inbound webhook event ${event.eventId} to stream ${this.STREAM_NAME} with message ID ${messageId}`,
      );

      return messageId;
    } catch (error) {
      this.logger.error(
        `Failed to publish inbound webhook event ${event.eventId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw error;
    }
  }
}


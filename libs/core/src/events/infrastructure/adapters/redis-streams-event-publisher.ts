/**
 * Redis Streams Event Publisher
 *
 * Implements EventPublisherPort using Redis Streams. Publishes events to Redis
 * Streams using the XADD command, storing all event envelope fields as string
 * key-value pairs for Redis Streams compatibility.
 *
 * @module libs/core/src/events/infrastructure/adapters
 * @implements {EventPublisherPort}
 * @see {@link EventPublisherPort} for the port interface
 */
import { Injectable, Inject } from '@nestjs/common';
import { RedisClientType } from 'redis';
import type { EventPublisherPort } from '../../domain/ports/event-publisher.port';
import type { EventEnvelope } from '../../domain/types/event.types';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class RedisStreamsEventPublisher implements EventPublisherPort {
  private readonly logger = new Logger(RedisStreamsEventPublisher.name);

  constructor(
    @Inject('REDIS_CLIENT')
    private readonly redisClient: RedisClientType
  ) {}

  async publish(streamName: string, event: EventEnvelope): Promise<string> {
    try {
      // Build field map for XADD command
      // All values must be strings for Redis Streams
      const fields: Record<string, string> = {
        eventId: event.eventId,
        eventType: event.eventType,
        payloadJson: event.payloadJson,
        occurredAt: event.occurredAt,
        publishedAt: event.publishedAt,
      };

      // Add optional metadata if present
      if (event.metadataJson) {
        fields.metadataJson = event.metadataJson;
      }

      // Publish to Redis Stream using XADD
      // XADD streamName * field1 value1 field2 value2 ...
      // Returns message ID (e.g., "1234567890-0")
      const messageId = await this.redisClient.xAdd(streamName, '*', fields);

      if (!messageId) {
        throw new Error(`Failed to publish event to stream: ${streamName}`);
      }

      this.logger.debug(
        `Published event ${event.eventId} to stream ${streamName} with message ID ${messageId}`
      );

      return messageId;
    } catch (error) {
      this.logger.error(
        `Failed to publish event ${event.eventId} to stream ${streamName}`,
        error instanceof Error ? error.stack : String(error)
      );

      // Convert Redis errors to domain exceptions
      if (error instanceof Error) {
        throw new Error(`Event publishing failed: ${error.message}`);
      }

      throw new Error('Event publishing failed: Unknown error');
    }
  }
}

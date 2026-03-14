/**
 * Event Publisher Port
 *
 * Defines the contract for publishing events to the event bus. Implemented by
 * infrastructure adapters (e.g., Redis Streams) to provide event publishing
 * capabilities. This port abstracts the event bus implementation, allowing
 * the core domain to publish events without depending on specific infrastructure.
 *
 * @module libs/core/src/events/domain/ports
 * @see {@link RedisStreamsEventPublisher} for the Redis Streams implementation
 */
import { EventEnvelope } from '../types/event.types';

/**
 * Event Publisher Port
 *
 * Interface for publishing events to the event bus. Implementations handle
 * the specifics of the underlying event bus technology (Redis Streams, RabbitMQ, etc.).
 */
export interface EventPublisherPort {
  /**
   * Publish an event to the specified stream
   *
   * @param streamName - The name of the stream to publish to (e.g., 'events.inbound.webhooks')
   * @param event - The event envelope to publish
   * @returns Promise resolving to the message ID assigned by the event bus
   * @throws Error if publishing fails
   */
  publish(streamName: string, event: EventEnvelope): Promise<string>;
}







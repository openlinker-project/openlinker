/**
 * Event Envelope Types
 *
 * Defines the EventEnvelope type for Redis Streams event publishing.
 * All fields are strings to ensure Redis Streams compatibility and avoid
 * serialization ambiguity. Timestamps are ISO 8601 strings, and payloads
 * are stringified JSON.
 *
 * @module libs/core/src/events/domain/types
 */

/**
 * Event Envelope
 *
 * Wrapper for events published to Redis Streams. All fields are strings
 * to ensure compatibility with Redis Streams key/value storage.
 */
export interface EventEnvelope {
  /**
   * Unique event identifier (UUID or deterministic)
   */
  eventId: string;

  /**
   * Event type identifier (e.g., 'inbound.webhook', 'product.created')
   */
  eventType: string;

  /**
   * Event payload as stringified JSON
   * Always a string, even if the payload is an empty object
   */
  payloadJson: string;

  /**
   * Optional metadata as stringified JSON
   * Includes schemaVersion for future evolution
   */
  metadataJson?: string;

  /**
   * ISO 8601 timestamp when the event occurred (from source)
   */
  occurredAt: string;

  /**
   * ISO 8601 timestamp when the event was published to the stream
   */
  publishedAt: string;
}


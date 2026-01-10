/**
 * Inbound Webhook Event Types
 *
 * Defines the InboundWebhookEvent type for webhook ingestion events published
 * to the event bus. All timestamp fields are ISO 8601 strings for Redis Streams
 * compatibility.
 *
 * @module libs/core/src/events/domain/types
 */

/**
 * Inbound Webhook Event
 *
 * Represents an inbound webhook event from an external system (e.g., PrestaShop).
 * This event is published to the event bus and consumed by handlers that trigger
 * sync jobs. All timestamps are ISO 8601 strings for Redis Streams compatibility.
 */
export interface InboundWebhookEvent {
  /**
   * Unique event identifier (from webhook payload)
   */
  eventId: string;

  /**
   * Provider identifier (e.g., 'prestashop')
   */
  provider: string;

  /**
   * Connection identifier (UUID)
   */
  connectionId: string;

  /**
   * Event type (e.g., 'product.saved', 'stock.changed', 'order.created')
   */
  eventType: string;

  /**
   * ISO 8601 timestamp when the event occurred (from webhook payload)
   */
  occurredAt: string;

  /**
   * ISO 8601 timestamp when the event was received by OpenLinker
   */
  receivedAt: string;

  /**
   * Object type (e.g., 'product', 'order', 'stock')
   */
  objectType: string;

  /**
   * External object identifier
   */
  externalId: string;

  /**
   * Optional payload data (minimal, webhook payload is not the source of truth)
   */
  payload?: Record<string, unknown>;
}








/**
 * Canonical Inbound Event Types
 *
 * Neutral, plugin-agnostic representation of an inbound webhook event,
 * produced by a `WebhookEventTranslatorPort` and consumed by the core
 * inbound routing policy (ADR-015). It is a **transient, in-process value**
 * passed between two co-located seams (api-side translate → core route);
 * it is never persisted, so it carries **no `schemaVersion`** — the durable,
 * versioned contract is the emitted `SyncJobRequest` payload.
 *
 * `domain` is the routing key (closed, additive core union). `eventType` is
 * an **advisory** source-vocabulary string — for the `order` domain the
 * routing policy coerces it to the poll-path `OrderFeedEventType`; the master
 * domains ignore it. `payload` is a non-authoritative hint (never source of
 * truth — the trigger fans out to an authoritative pull).
 *
 * @module libs/core/src/integrations/domain/types
 */

export const InboundEventDomainValues = ['order', 'inventory', 'product', 'shipment'] as const;

export type InboundEventDomain = (typeof InboundEventDomainValues)[number];

export interface CanonicalInboundEvent {
  /** Routing key — which core domain this event concerns. */
  domain: InboundEventDomain;
  /** Source-native external identifier (order/product/stock id). */
  externalId: string;
  /**
   * Advisory source-vocabulary event type (e.g. `created`, `updated`,
   * `stock.changed`). Consumed only by the `order` domain (coerced to
   * `OrderFeedEventType`); master domains ignore it.
   */
  eventType: string;
  /** ISO 8601 occurrence time from the webhook (advisory). */
  occurredAt?: string;
  /** Non-authoritative payload hint; never source of truth. */
  payload?: Record<string, unknown>;
}

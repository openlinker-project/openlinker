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

export const InboundEventDomainValues = [
  'order',
  'inventory',
  'product',
  'shipment',
  'invoicing',
  // Payment-status change of an issued document (#1354) — kept distinct from
  // `invoicing` (regulatory clearance) so the routing policy nudges the
  // payment-refresh job, not the regulatory-status reconcile.
  'invoice-payment',
  // Fulfilment progress from an executor (#2400, ADR-054). Gated on
  // `FulfillmentExecutor`. Note the arm resolves `ungated` on every shipped
  // deployment today: the capability is in `CoreCapabilityValues` but NO
  // shipped adapter manifest advertises it yet, so no connection can have it
  // both supported and enabled. The member exists so that when one does, the
  // delivery ROUTES rather than dead-lettering — the inverse of ADR-042's
  // eparagony decision, which declined to register a decoder precisely because
  // there was no domain member and no job to route to.
  'fulfillment',
  // Customer-return notification (#2330/#2400). Gated on `OrderSource`, NEVER
  // on `ReturnSourceReader`: that is a guard-only sub-capability narrowed off
  // the dispatched `OrderSource` adapter, absent from `CoreCapabilityValues`,
  // so `connection.enabledCapabilities` can never contain it and the arm would
  // be permanently `ungated` (the #2085 stamped-at-create trap).
  'return',
] as const;

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

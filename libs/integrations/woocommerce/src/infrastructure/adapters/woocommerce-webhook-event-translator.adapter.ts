/**
 * WooCommerce Webhook Event Translator Adapter (#1548 / ADR-015)
 *
 * Decodes WooCommerce inbound webhook events into neutral
 * `CanonicalInboundEvent`s. Pure transform — no I/O, no connection state.
 * WooCommerce delivers topic-based order events (`order.created`,
 * `order.updated`); the decoder that runs before this translator sets
 * `objectType = 'order'` and carries the WC topic (or its bare action) as
 * `eventType`.
 *
 * This is the only place that holds WooCommerce's webhook vocabulary — the
 * core `InboundRoutingPolicy` maps the neutral `domain` -> `jobType`
 * (order -> `marketplace.order.sync`, gated on the `OrderSource` capability)
 * with zero platform knowledge. Unknown object types return `null`
 * (-> dead-letter), keeping the translator total (ADR-015 invariant 5).
 *
 * WooCommerce is treated as an order SOURCE over webhooks: the webhook is a
 * low-latency nudge, never the source of truth. The advisory `eventType` is
 * coerced by the routing policy to an `OrderFeedEventType`; the authoritative
 * order is re-pulled by `WooCommerceOrderSourceAdapter.getOrder` downstream.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @see {@link CanonicalInboundEvent} for the neutral output contract
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

export class WooCommerceWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    const objectType = event.objectType.toLowerCase();

    switch (objectType) {
      case 'order':
        return {
          domain: 'order',
          externalId: event.externalId,
          eventType: this.orderEventType(event.eventType),
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      default:
        // Unknown object type — not decodable by this plugin -> dead-letter.
        return null;
    }
  }

  /**
   * Map the WooCommerce order event type into the order domain's advisory
   * vocabulary. Accepts both the full WC topic (`order.created`) and its bare
   * action (`created`). Only `order.created` / `order.updated` are provisioned
   * (see `WOOCOMMERCE_ORDER_WEBHOOK_TOPICS`); `OrderFeedEventType` has no
   * `status_changed`, so anything that isn't a create falls back to `updated`
   * (a safe re-pull — the authoritative order is fetched downstream).
   */
  private orderEventType(eventType: string): string {
    switch (eventType.toLowerCase()) {
      case 'order.created':
      case 'created':
        return 'created';
      case 'order.updated':
      case 'updated':
      default:
        return 'updated';
    }
  }
}

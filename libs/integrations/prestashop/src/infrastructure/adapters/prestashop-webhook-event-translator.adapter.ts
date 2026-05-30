/**
 * PrestaShop Webhook Event Translator Adapter (#903 / ADR-015)
 *
 * Decodes PrestaShop OL-module inbound webhook events into neutral
 * `CanonicalInboundEvent`s. Pure transform — no I/O, no connection state.
 * The PS module emits these `objectType`/`eventType` pairs:
 *   - `order`   + `order.created` / `order.status_changed`
 *   - `stock`   + `stock.changed`      → canonical domain `inventory`
 *   - `product` + `product.saved`
 * (`test.ping` is short-circuited by the dispatcher before translation.)
 *
 * This is the only place that holds PrestaShop's webhook vocabulary — the
 * core routing policy maps `domain → job` with zero platform knowledge.
 * Unknown object types return `null` (→ dead-letter), keeping the translator
 * total (ADR-015 invariant 5).
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

export class PrestashopWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
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
      case 'stock':
        return {
          domain: 'inventory',
          externalId: event.externalId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      case 'product':
        return {
          domain: 'product',
          externalId: event.externalId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      default:
        // Unknown object type — not decodable by this plugin → dead-letter.
        return null;
    }
  }

  /**
   * Map the PS order event type into the order domain's advisory vocabulary.
   * `OrderFeedEventType` has no `status_changed`, so a status change is an
   * `updated`; unknown order events also fall back to `updated` (a safe re-pull).
   */
  private orderEventType(eventType: string): string {
    switch (eventType) {
      case 'order.created':
        return 'created';
      case 'order.status_changed':
        return 'updated';
      default:
        return 'updated';
    }
  }
}

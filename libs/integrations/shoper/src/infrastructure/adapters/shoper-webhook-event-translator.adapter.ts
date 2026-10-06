/**
 * Shoper Webhook Event Translator Adapter (#3644, ADR-015)
 *
 * Decodes a Shoper order webhook envelope into the neutral `CanonicalInboundEvent`
 * the host routes. Every order event routes to `marketplace.order.sync`, which
 * re-reads the order through `OrderSource`: the webhook only nudges, it is never
 * the source of truth (#904).
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {WebhookEventTranslatorPort}
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

import { SHOPER_WEBHOOK_ORDER_RESOURCE } from '../../domain/types/shoper-webhook.types';

export class ShoperWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    if (event.objectType.toLowerCase() !== SHOPER_WEBHOOK_ORDER_RESOURCE) {
      // Not decodable by this plugin -> dead-letter.
      return null;
    }
    return {
      domain: 'order',
      externalId: event.externalId,
      eventType: this.orderEventType(event.eventType),
      occurredAt: event.occurredAt,
      payload: event.payload,
    };
  }

  /**
   * `order.create` is a create; every other order event (`order.edit`,
   * `order.paid`, `order.status`) is an update, because the order domain's
   * advisory vocabulary has no finer verb and the authoritative order is fetched
   * downstream either way. A cancellation is NOT inferred here: it comes from the
   * re-read order's status, not from the event name.
   */
  private orderEventType(eventType: string): string {
    return eventType.toLowerCase() === 'order.create' ? 'created' : 'updated';
  }
}

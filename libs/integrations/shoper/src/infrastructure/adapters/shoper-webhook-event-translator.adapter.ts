/**
 * Shoper Webhook Event Translator Adapter (#3644, ADR-015)
 *
 * Decodes a Shoper webhook envelope into the neutral `CanonicalInboundEvent` the
 * host routes. Every order event becomes the `order` domain
 * (`marketplace.order.sync`, which re-reads the order through `OrderSource`);
 * every product event becomes the `product` domain
 * (`master.product.syncByExternalId`, which re-reads the product through
 * `ProductMaster` and treats its 404 as the deletion, #2647). The webhook only
 * nudges, it is never the source of truth (#904).
 *
 * A panel STOCK edit also arrives as `product.edit`, and is routed to the product
 * domain like any other edit: one delivery yields one event. Stock therefore
 * reaches OpenLinker through the inventory sweep, not through this trigger.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {WebhookEventTranslatorPort}
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

import {
  SHOPER_WEBHOOK_ORDER_RESOURCE,
  SHOPER_WEBHOOK_PRODUCT_RESOURCE,
} from '../../domain/types/shoper-webhook.types';

export class ShoperWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | null {
    switch (event.objectType.toLowerCase()) {
      case SHOPER_WEBHOOK_ORDER_RESOURCE:
        return {
          domain: 'order',
          externalId: event.externalId,
          eventType: this.orderEventType(event.eventType),
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      case SHOPER_WEBHOOK_PRODUCT_RESOURCE:
        // The product domain's route carries no event type, so the raw name is
        // passed through for the delivery record only (the PrestaShop posture).
        return {
          domain: 'product',
          externalId: event.externalId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      default:
        // Not decodable by this plugin -> dead-letter.
        return null;
    }
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

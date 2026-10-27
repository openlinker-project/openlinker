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
 * A panel STOCK edit also arrives as `product.edit` - Shoper has no separate
 * stock event - so `product.edit` fans out into TWO events: the product re-read
 * first (the primary, the job recorded on the delivery row) and an inventory
 * re-read (`master.inventory.syncByExternalId`). Without the second, a stock
 * change made in the panel waited for the inventory sweep. The inventory event
 * is gated like any other: on a connection without `InventoryMaster` enabled it
 * resolves `ungated` and only the product job is created.
 *
 * `product.create` and `product.delete` stay single: a fresh product's stock is
 * read by the product sync that creates it, and a deletion is the product
 * re-read's 404, which an inventory re-read would only repeat.
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

/** The one product event that can mean a stock change (Shoper sends no stock event). */
const SHOPER_PRODUCT_EDIT_EVENT = 'product.edit';

export class ShoperWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | CanonicalInboundEvent[] | null {
    switch (event.objectType.toLowerCase()) {
      case SHOPER_WEBHOOK_ORDER_RESOURCE:
        return {
          domain: 'order',
          externalId: event.externalId,
          eventType: this.orderEventType(event.eventType),
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      case SHOPER_WEBHOOK_PRODUCT_RESOURCE: {
        // The product and inventory routes carry no event type, so the raw name
        // is passed through for the delivery record only (the PrestaShop posture).
        const product = this.productScoped('product', event);
        return event.eventType.toLowerCase() === SHOPER_PRODUCT_EDIT_EVENT
          ? [product, this.productScoped('inventory', event)]
          : product;
      }
      default:
        // Not decodable by this plugin -> dead-letter.
        return null;
    }
  }

  /** A product-keyed event: the inventory sync takes the same Shoper `product_id`. */
  private productScoped(
    domain: 'product' | 'inventory',
    event: InboundWebhookEvent
  ): CanonicalInboundEvent {
    return {
      domain,
      externalId: event.externalId,
      eventType: event.eventType,
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

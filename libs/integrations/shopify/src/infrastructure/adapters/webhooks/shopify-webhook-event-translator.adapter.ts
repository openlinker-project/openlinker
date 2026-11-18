/**
 * Shopify Webhook Event Translator Adapter (#3981, ADR-015)
 *
 * Turns a decoded Shopify envelope into the neutral `CanonicalInboundEvent` the
 * host routes. Registered by adapter key.
 *
 * Every order topic becomes the `order` domain (`marketplace.order.sync`, which
 * re-reads the order through `OrderSource`). `orders/create` is `created`; every
 * other order topic, `orders/cancelled` included, is `updated`, because the
 * cancellation is read from the re-read order, not inferred from the topic.
 *
 * Every product topic becomes the `product` domain
 * (`master.product.syncByExternalId`). `products/update` also yields an
 * `inventory` event (`master.inventory.syncByExternalId`), the Shoper
 * `product.edit` shape (ADR-049 § Amendment): a stock edit made on the product
 * in the admin updates the product and so tends to arrive as `products/update`.
 * That is NOT guaranteed for a change made purely through the inventory-level
 * API, which is why `inventory_levels/update` is subscribed too: it becomes an
 * `inventory` event whose id packs the inventory item and location, resolved
 * to a product when the sync runs (the translator stays I/O-free). The
 * inventory sweep stays the backstop for anything a webhook misses. The host gates the
 * inventory event on `InventoryMaster`, so a connection without it gets only the
 * product job. `products/delete` stays single: the product re-read's not-found
 * runs the deletion path, and an inventory re-read would only repeat it.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters/webhooks
 * @implements {WebhookEventTranslatorPort}
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import type {
  CanonicalInboundEvent,
  WebhookEventTranslatorPort,
} from '@openlinker/core/integrations';

import {
  SHOPIFY_ORDER_CREATE_TOPIC,
  SHOPIFY_PRODUCT_UPDATE_TOPIC,
  SHOPIFY_WEBHOOK_INVENTORY_RESOURCE,
  SHOPIFY_WEBHOOK_ORDER_RESOURCE,
  SHOPIFY_WEBHOOK_PRODUCT_RESOURCE,
} from '../../../domain/types/shopify-webhook.types';

export class ShopifyWebhookEventTranslatorAdapter implements WebhookEventTranslatorPort {
  translate(event: InboundWebhookEvent): CanonicalInboundEvent | CanonicalInboundEvent[] | null {
    const topic = event.eventType.toLowerCase();
    switch (event.objectType.toLowerCase()) {
      case SHOPIFY_WEBHOOK_ORDER_RESOURCE:
        return {
          domain: 'order',
          externalId: event.externalId,
          eventType: topic === SHOPIFY_ORDER_CREATE_TOPIC ? 'created' : 'updated',
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      case SHOPIFY_WEBHOOK_PRODUCT_RESOURCE: {
        const product = productScoped('product', event);
        return topic === SHOPIFY_PRODUCT_UPDATE_TOPIC ? [product, productScoped('inventory', event)] : product;
      }
      case SHOPIFY_WEBHOOK_INVENTORY_RESOURCE:
        // `externalId` is the packed inventory item + location id: the sync
        // resolves it to a product (`InventoryEventTargetResolver`).
        return {
          domain: 'inventory',
          externalId: event.externalId,
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          payload: event.payload,
        };
      default:
        // Not decodable by this plugin: the host dead-letters it.
        return null;
    }
  }
}

/** The inventory sync takes the same Shopify product id as the product sync. */
function productScoped(domain: 'product' | 'inventory', event: InboundWebhookEvent): CanonicalInboundEvent {
  return {
    domain,
    externalId: event.externalId,
    // Master routes ignore it; passed through for the delivery record only.
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };
}

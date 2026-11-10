/**
 * Shopify Webhook Types (#3981)
 *
 * Vocabulary shared by the inbound decoder, the event translator and the
 * webhook provisioner, so the topics a shop is subscribed to and the topics the
 * decoder routes cannot drift apart.
 *
 * @module libs/integrations/shopify/src/domain/types
 */
import { SHOPIFY_PLATFORM_TYPE } from '../../shopify.constants';

/** Provider key of the inbound route `/webhooks/:provider/:connectionId`: the platform type. */
export const SHOPIFY_WEBHOOK_PROVIDER = SHOPIFY_PLATFORM_TYPE;

/** base64(HMAC-SHA256(app client secret, raw body)). */
export const SHOPIFY_WEBHOOK_HMAC_HEADER = 'x-shopify-hmac-sha256';

/** REST-style topic name, e.g. `orders/create`. */
export const SHOPIFY_WEBHOOK_TOPIC_HEADER = 'x-shopify-topic';

/** One delivery; Shopify's own guidance is to deduplicate on it, so it is the dedup key. */
export const SHOPIFY_WEBHOOK_ID_HEADER = 'x-shopify-webhook-id';

/** When Shopify triggered the event. Advisory only, never a replay check (see the decoder). */
export const SHOPIFY_WEBHOOK_TRIGGERED_AT_HEADER = 'x-shopify-triggered-at';

/** The neutral object type of an order delivery. */
export const SHOPIFY_WEBHOOK_ORDER_RESOURCE = 'order';

/** The neutral object type of a product delivery. */
export const SHOPIFY_WEBHOOK_PRODUCT_RESOURCE = 'product';

export type ShopifyWebhookResource =
  | typeof SHOPIFY_WEBHOOK_ORDER_RESOURCE
  | typeof SHOPIFY_WEBHOOK_PRODUCT_RESOURCE;

export const SHOPIFY_ORDER_WEBHOOK_TOPICS = ['orders/create', 'orders/updated', 'orders/cancelled'] as const;

export const SHOPIFY_PRODUCT_WEBHOOK_TOPICS = ['products/create', 'products/update', 'products/delete'] as const;

export type ShopifyWebhookTopic =
  | (typeof SHOPIFY_ORDER_WEBHOOK_TOPICS)[number]
  | (typeof SHOPIFY_PRODUCT_WEBHOOK_TOPICS)[number];

export const SHOPIFY_ORDER_CREATE_TOPIC = 'orders/create';

/**
 * The product topic that also triggers a stock re-read. Shopify's own stock
 * topic (`inventory_levels/update`) is keyed by inventory item and location, not
 * by product, so it cannot feed the product-keyed inventory sync directly.
 */
export const SHOPIFY_PRODUCT_UPDATE_TOPIC = 'products/update';

/** The `WebhookSubscriptionTopic` enum value of each topic (Admin API 2026-10). */
export const SHOPIFY_WEBHOOK_TOPIC_ENUM: Readonly<Record<ShopifyWebhookTopic, string>> = {
  'orders/create': 'ORDERS_CREATE',
  'orders/updated': 'ORDERS_UPDATED',
  'orders/cancelled': 'ORDERS_CANCELLED',
  'products/create': 'PRODUCTS_CREATE',
  'products/update': 'PRODUCTS_UPDATE',
  'products/delete': 'PRODUCTS_DELETE',
};

/** The resource a topic concerns, or null for a topic OpenLinker does not handle. */
export function shopifyWebhookResourceOf(topic: string): ShopifyWebhookResource | null {
  const normalised = topic.trim().toLowerCase();
  if ((SHOPIFY_ORDER_WEBHOOK_TOPICS as readonly string[]).includes(normalised)) {
    return SHOPIFY_WEBHOOK_ORDER_RESOURCE;
  }
  if ((SHOPIFY_PRODUCT_WEBHOOK_TOPICS as readonly string[]).includes(normalised)) {
    return SHOPIFY_WEBHOOK_PRODUCT_RESOURCE;
  }
  return null;
}

/** One row of `webhookSubscriptions { nodes { id topic uri } }`. */
export interface ShopifyWebhookSubscriptionNode {
  readonly id: string;
  readonly topic: string;
  readonly uri: string | null;
}

/**
 * WooCommerce Webhook Types & Constants (#1548)
 *
 * Shared vocabulary for the WooCommerce inbound-webhook seam — used by both
 * `WooCommerceWebhookProvisioningAdapter` (registers the store-side webhooks
 * via WC REST `/webhooks`) and `WooCommerceWebhookEventTranslatorAdapter`
 * (decodes a delivered event into a neutral `CanonicalInboundEvent`).
 *
 * WooCommerce's own webhook subsystem (WP Admin -> WooCommerce -> Settings ->
 * Advanced -> Webhooks, or REST `POST /wp-json/wc/v3/webhooks`) delivers a
 * topic-based event to a `delivery_url`, signed with a base64 HMAC-SHA256 of
 * the raw body in the `X-WC-Webhook-Signature` header. It sends NO signed
 * timestamp header. See `docs/architecture-overview.md` (webhook ingestion)
 * for how the host authenticates inbound deliveries.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 */

/** Webhook-secret provider key + URL `:provider` segment for WooCommerce connections. */
export const WOOCOMMERCE_WEBHOOK_PROVIDER = 'woocommerce';

/** WooCommerce REST v3 webhooks collection resource. */
export const WOOCOMMERCE_WEBHOOKS_PATH = '/wp-json/wc/v3/webhooks';

/**
 * WooCommerce delivery signature header (base64 HMAC-SHA256 of the raw body,
 * keyed by the webhook's `secret`). Documented here as the authoritative name
 * for the future inbound decoder (see the provisioning adapter's signature
 * note); the host default OL-HMAC decoder does not read it yet.
 */
export const WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER = 'x-wc-webhook-signature';

/**
 * Order-relevant WooCommerce webhook topics OL provisions. WooCommerce is used
 * here as an order SOURCE over webhooks (low-latency nudge; the poll reconciles),
 * so only the order lifecycle topics are registered. `order.created` and
 * `order.updated` together cover the "new order" and "status/detail changed"
 * signals; the authoritative order is always re-pulled downstream.
 */
export const WOOCOMMERCE_ORDER_WEBHOOK_TOPICS = ['order.created', 'order.updated'] as const;

export type WooCommerceOrderWebhookTopic = (typeof WOOCOMMERCE_ORDER_WEBHOOK_TOPICS)[number];

/** Body OL sends to WC REST when creating or updating a webhook. */
export interface WooCommerceWebhookWriteBody {
  name: string;
  topic: string;
  delivery_url: string;
  secret: string;
  status: 'active';
}

/** Subset of the WC webhook resource OL reads back when listing/creating. */
export interface WooCommerceWebhookResource {
  id: number;
  name?: string;
  status?: string;
  topic?: string;
  delivery_url?: string;
}

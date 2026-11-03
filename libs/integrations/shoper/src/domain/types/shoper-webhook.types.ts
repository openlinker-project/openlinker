/**
 * Shoper Webhook Types
 *
 * Constants and wire shapes for Shoper's webhooks (#3644), all verified against
 * a live shop (6 Oct 2026; product events 22-23 Oct 2026). One Shoper webhook
 * carries MANY events, so one registration covers every order and product event
 * OpenLinker listens to.
 *
 * Shoper does NOT retry a failed delivery, and an integration token's own API
 * writes do not fire that integration's webhooks (anti-echo, measured), so a
 * product OpenLinker publishes does not bounce back as a `product.edit`.
 *
 * Authentication is two checks over ONE per-connection secret, both required:
 * the token in the delivery URL, and Shoper's `x-webhook-sha1` signature,
 * `sha1(webhook_id + ":" + secret + ":" + rawBody)` in hex (resolved against
 * 12+ live deliveries, 2026-10-23, after SPIKE-3638 X5 left it open). The
 * provisioner registers the secret as the webhook's `secret` (the signing key)
 * and puts only a one-way derivative of it in the URL
 * (`deriveShoperWebhookUrlToken`), because the URL is displayed in the shop
 * panel and logged by proxies, and must not carry the signing key.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
import { SHOPER_PLATFORM_TYPE } from '../../shoper.constants';

/** Provider key of the inbound route `/webhooks/:provider/:connectionId` - the platform type. */
export const SHOPER_WEBHOOK_PROVIDER = SHOPER_PLATFORM_TYPE;

/** Query parameter of the delivery URL that carries the URL token (a derivative of the secret). */
export const SHOPER_WEBHOOK_TOKEN_QUERY_KEY = 'token';

/**
 * HMAC message from which the URL token is derived. Versioned and namespaced so
 * the derived value is bound to this one purpose: any other value ever derived
 * from the same secret uses another label and cannot be swapped for this one.
 * Changing it invalidates the URL of every installed webhook, so a new scheme
 * gets a new version and the decoder keeps accepting the old one until every
 * connection has re-run install.
 */
export const SHOPER_WEBHOOK_URL_TOKEN_LABEL = 'shoper-webhook-url-token:v1';

/**
 * The URL token a delivery authenticated with: the derived token, or the raw
 * secret that webhooks installed before the derivation still carry.
 */
export type ShoperWebhookUrlTokenKind = 'derived' | 'legacy';

/** Delivery header naming the event (`order.create`, ...). */
export const SHOPER_WEBHOOK_NAME_HEADER = 'x-webhook-name';

/** Delivery header carrying the shop-side webhook id, the first part of the signed string. */
export const SHOPER_WEBHOOK_ID_HEADER = 'x-webhook-id';

/** Delivery header carrying the hex SHA-1 signature. */
export const SHOPER_WEBHOOK_SIGNATURE_HEADER = 'x-webhook-sha1';

/** The neutral object type of an order delivery. */
export const SHOPER_WEBHOOK_ORDER_RESOURCE = 'order';

/** The neutral object type of a product delivery. */
export const SHOPER_WEBHOOK_PRODUCT_RESOURCE = 'product';

/** The object types the decoder routes; anything else is ignored. */
export type ShoperWebhookResource =
  | typeof SHOPER_WEBHOOK_ORDER_RESOURCE
  | typeof SHOPER_WEBHOOK_PRODUCT_RESOURCE;

export const SHOPER_WEBHOOKS_PATH = '/webhooks';

/**
 * The order events OpenLinker registers. `order.delete` is deliberately absent:
 * the re-read it would trigger answers 404 and the job would retry a condition
 * retrying cannot change.
 */
export const SHOPER_ORDER_WEBHOOK_EVENTS = [
  'order.create',
  'order.edit',
  'order.paid',
  'order.status',
] as const;

export type ShoperOrderWebhookEvent = (typeof SHOPER_ORDER_WEBHOOK_EVENTS)[number];

/**
 * The product events OpenLinker registers, when `ProductMaster` is enabled. They
 * are triggers for a re-read of the product (#2647), never assertions:
 * `product.delete` is kept, unlike `order.delete`, because the 404 its re-read
 * answers IS the deletion signal the product sync acts on. `product.edit` fires
 * within a second on a panel product edit AND on a panel stock edit, and its
 * body is the whole product, stock included - none of which is read. Because the
 * two cannot be told apart, `product.edit` triggers both a product and an
 * inventory re-read (see the event translator).
 */
export const SHOPER_PRODUCT_WEBHOOK_EVENTS = [
  'product.create',
  'product.edit',
  'product.delete',
] as const;

export type ShoperProductWebhookEvent = (typeof SHOPER_PRODUCT_WEBHOOK_EVENTS)[number];

/** `GET /webhooks` row. `secret` is READABLE back (`''` when none was set). */
export interface ShoperWebhookRow {
  readonly webhook_id: string | number;
  readonly url: string;
  readonly active?: string | number | null;
  readonly format?: string | number | null;
  readonly events?: readonly string[] | null;
  readonly secret?: string | null;
}

/**
 * `POST` / `PUT /webhooks` body. `format` is REQUIRED on create (a body without it
 * is a 400 naming the field); a `PUT` accepts a partial body.
 */
export interface ShoperWebhookWriteBody {
  readonly url: string;
  readonly events: readonly string[];
  readonly active: 0 | 1;
  readonly format: 0;
  readonly secret: string;
}

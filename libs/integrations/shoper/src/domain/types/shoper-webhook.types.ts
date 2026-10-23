/**
 * Shoper Webhook Types
 *
 * Constants and wire shapes for Shoper's webhooks (#3644), all verified against
 * a live shop (6 Oct 2026). One Shoper webhook carries MANY events, so one
 * registration covers every order event OpenLinker listens to.
 *
 * Authentication is two checks over ONE per-connection secret, both required:
 * the token in the delivery URL, and Shoper's `x-webhook-sha1` signature,
 * `sha1(webhook_id + ":" + secret + ":" + rawBody)` in hex (resolved against
 * 12+ live deliveries, 2026-10-23, after SPIKE-3638 X5 left it open). The
 * provisioner registers the same secret as the URL token and as the webhook's
 * `secret`, so neither check needs anything the other does not.
 *
 * @module libs/integrations/shoper/src/domain/types
 */
import { SHOPER_PLATFORM_TYPE } from '../../shoper.constants';

/** Provider key of the inbound route `/webhooks/:provider/:connectionId` - the platform type. */
export const SHOPER_WEBHOOK_PROVIDER = SHOPER_PLATFORM_TYPE;

/** Query parameter of the delivery URL that carries the per-connection secret. */
export const SHOPER_WEBHOOK_TOKEN_QUERY_KEY = 'token';

/** Delivery header naming the event (`order.create`, ...). */
export const SHOPER_WEBHOOK_NAME_HEADER = 'x-webhook-name';

/** Delivery header carrying the shop-side webhook id, the first part of the signed string. */
export const SHOPER_WEBHOOK_ID_HEADER = 'x-webhook-id';

/** Delivery header carrying the hex SHA-1 signature. */
export const SHOPER_WEBHOOK_SIGNATURE_HEADER = 'x-webhook-sha1';

/** The neutral object type of an order delivery. */
export const SHOPER_WEBHOOK_ORDER_RESOURCE = 'order';

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

/**
 * Shoper Inbound Webhook Decoder Adapter (#3644, ADR-021)
 *
 * Authenticates and decodes Shoper order and product webhooks at the host
 * ingress, keyed by `provider = 'shoper'`.
 *
 * AUTHENTICATION: two checks, BOTH required, over the one per-connection
 * webhook secret the host supplies:
 *   - the token in the delivery URL (`?token=<urlToken>`), where
 *     `urlToken = deriveShoperWebhookUrlToken(secret)` is recomputed here and
 *     compared in constant time; and
 *   - Shoper's signature, `x-webhook-sha1 = hex(sha1(webhook_id + ":" + secret +
 *     ":" + rawBody))`, with `webhook_id` taken from `x-webhook-id`, computed
 *     over the RAW body bytes with the secret itself and compared in constant
 *     time. Verified against 12+ real deliveries (2026-10-23).
 * The two checks guard different things. The secret is the signing key and is
 * never in the URL; the URL token is a one-way derivative of it, so the URL -
 * shown in plain text in the shop's webhook list and written to reverse-proxy /
 * CDN / tunnel access logs - can leak without letting its reader sign a
 * delivery. Re-running webhook install rotates the secret, and with it the
 * token.
 *
 * REPLAY PROTECTION: there is no replay window, because Shoper gives us nothing
 * to build one from. A delivery carries no delivery timestamp at all - no
 * timestamp header, signed or unsigned, and no send-time field in the body (the
 * dates it does carry, such as a product's `edit_date`, describe the record, not
 * the delivery). So `verify` omits `timestampMs` and the host's
 * skew-window check never fires (the WooCommerce and Erli posture). Replay
 * protection is therefore the Postgres dedup gate alone: `deriveEventId` hashes
 * the event name and the exact body, so a replayed delivery collides with the
 * original on `webhook_deliveries` and enqueues nothing. That is acceptable
 * rather than a gap because even a replay that did get through costs at most
 * one extra re-read of the record: a webhook here is only a trigger (see
 * TRIGGER MODEL, #904) and nothing it carries is ever written.
 *
 * LEGACY URL TOKEN (accepted, warned about): a webhook installed before the URL
 * token was derived carries the raw secret as `?token=`. Such a delivery is
 * still accepted, provided its signature verifies, and logs a warning naming
 * the remedy - re-running "Configure webhooks" on the connection, which rotates
 * the secret and registers the derived token. Accepting it is safe: the
 * signature check already requires the secret, and anyone holding the secret
 * can compute the derived token anyway, so the legacy branch admits no request
 * the derived branch would refuse. Rejecting it instead would close nothing (the
 * old URL has already exposed that secret, and only a rotation retires it) while
 * silently cutting every not-yet-reinstalled connection off its webhooks. The
 * warning is logged only after the signature verifies, so an unauthenticated
 * caller cannot use it to flood the log.
 *
 * TRIGGER MODEL: the delivery carries the whole order or product, and the
 * decoder reads only its id. The authoritative record is re-read - an order
 * through `ShoperOrderSourceAdapter` by `marketplace.order.sync`, a product
 * through the product master by `master.product.syncByExternalId` (#2647) - so a
 * forged or stale body can at worst cause one redundant re-read. A
 * `product.delete` is likewise only a trigger: the re-read's 404 is what marks
 * the product deleted, so a delete that did not happen costs one re-sync.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters
 * @implements {InboundWebhookDecoderPort}
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

import { deriveShoperWebhookUrlToken } from '../../domain/policies/shoper-webhook-url-token.policy';
import {
  SHOPER_WEBHOOK_ID_HEADER,
  SHOPER_WEBHOOK_NAME_HEADER,
  SHOPER_WEBHOOK_ORDER_RESOURCE,
  SHOPER_WEBHOOK_PRODUCT_RESOURCE,
  SHOPER_WEBHOOK_SIGNATURE_HEADER,
  SHOPER_WEBHOOK_TOKEN_QUERY_KEY,
  type ShoperWebhookResource,
  type ShoperWebhookUrlTokenKind,
} from '../../domain/types/shoper-webhook.types';

/** Fallback when a delivery names no event: treated as an update, i.e. a safe re-read. */
const DEFAULT_EVENT_BY_RESOURCE: Readonly<Record<ShoperWebhookResource, string>> = {
  order: 'order.edit',
  product: 'product.edit',
};

/** The body field carrying the id of each resource. */
const ID_FIELD_BY_RESOURCE: Readonly<Record<ShoperWebhookResource, string>> = {
  order: 'order_id',
  product: 'product_id',
};

export class ShoperInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  private readonly logger = new Logger(ShoperInboundWebhookDecoderAdapter.name);

  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
    query?: Readonly<Record<string, string>>;
  }): WebhookVerifyResult {
    if (input.secret.length === 0) {
      return { ok: false };
    }
    const tokenKind = this.classifyUrlToken(input.query?.[SHOPER_WEBHOOK_TOKEN_QUERY_KEY], input.secret);
    if (tokenKind === null) {
      return { ok: false };
    }

    const webhookId = this.header(input.headers, SHOPER_WEBHOOK_ID_HEADER);
    const signature = this.header(input.headers, SHOPER_WEBHOOK_SIGNATURE_HEADER);
    if (webhookId === undefined || signature === undefined) {
      return { ok: false };
    }
    const expected = createHash('sha1')
      .update(`${webhookId}:${input.secret}:`)
      .update(input.rawBody)
      .digest('hex');
    // Hex is case-insensitive; Shoper sends lower case, but a proxy that
    // normalises it must not turn an authentic delivery into a rejection.
    if (!constantTimeEquals(signature.toLowerCase(), expected)) {
      return { ok: false };
    }

    if (tokenKind === 'legacy') {
      // The decoder is not told the connection id; the host's own log lines for
      // this delivery carry it, and the shop-side webhook id names the webhook.
      this.logger.warn(
        `Shoper delivery from webhook ${webhookId} authenticated with a legacy URL token that ` +
          'exposes the webhook signing secret in the URL (visible in the shop panel and in access ' +
          'logs). Re-run "Configure webhooks" on this Shoper connection to rotate the secret and ' +
          'register a URL that no longer carries it.',
      );
    }
    return { ok: true };
  }

  /**
   * Which URL token the delivery carries: the derived one, the raw secret a
   * pre-derivation install put in the URL, or neither (null). Both comparisons
   * always run, so the time taken does not reveal which one matched.
   */
  private classifyUrlToken(token: string | undefined, secret: string): ShoperWebhookUrlTokenKind | null {
    if (typeof token !== 'string') {
      return null;
    }
    const matchesDerived = constantTimeEquals(token, deriveShoperWebhookUrlToken(secret));
    const matchesLegacy = constantTimeEquals(token, secret);
    if (matchesDerived) {
      return 'derived';
    }
    return matchesLegacy ? 'legacy' : null;
  }

  extractEnvelope(rawBody: Buffer, headers: Record<string, string>): DecodeResult {
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { action: 'reject', reason: 'body is not valid JSON' };
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { action: 'reject', reason: 'body is not a JSON object' };
    }

    const record = body as Record<string, unknown>;
    const eventName = this.header(headers, SHOPER_WEBHOOK_NAME_HEADER);
    const resource = eventName !== undefined ? resourceOfEvent(eventName) : resourceOfBody(record);
    if (resource === null) {
      // Authentic but not an event OpenLinker handles (someone registered more
      // events on the shop): 202 without publish, so it does not become a retry
      // storm.
      return {
        action: 'ignore',
        reason:
          eventName !== undefined
            ? `not an order or product event (${eventName})`
            : 'body has no order or product id',
      };
    }

    const id = this.asId(record[ID_FIELD_BY_RESOURCE[resource]]);
    if (id === null) {
      return { action: 'ignore', reason: `body has no ${resource} id` };
    }

    const eventType = eventName ?? DEFAULT_EVENT_BY_RESOURCE[resource];
    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(eventType, rawBody),
        eventType,
        // Advisory only: the body's timestamps are naive and shop-local.
        occurredAt: new Date().toISOString(),
        objectType: resource,
        externalId: id,
        payload: { id },
      },
    };
  }

  /**
   * Deterministic dedup key: the event name plus the exact body. Shoper does not
   * retry deliveries itself, but a replayed or duplicated one re-hashes to the
   * same id and is caught by the Postgres dedup gate; a real change alters the
   * body (`status_id`, `sum`, a product's `edit_date` or stock, ...). The
   * decode-time `now` used for `occurredAt` is deliberately NOT part of the basis -
   * hashing it would mint a fresh id on every retry and defeat dedup.
   */
  private deriveEventId(eventType: string, rawBody: Buffer): string {
    return createHash('sha256').update(eventType).update(':').update(rawBody).digest('hex');
  }

  private asId(raw: unknown): string | null {
    const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : '';
    return /^\d+$/.test(text) && text !== '0' ? text : null;
  }

  private header(headers: Record<string, string>, name: string): string | undefined {
    // HTTP header names are case-insensitive and a caller may hand them over in
    // any case, so match by lower-cased name instead of two exact spellings.
    const wanted = name.toLowerCase();
    const match = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
    const value = match?.[1];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }
}

function constantTimeEquals(provided: string, expected: string): boolean {
  if (provided.length === 0) {
    return false;
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, and the length of a random
  // secret or of a hex digest is not itself worth hiding.
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

/** The resource of an event name (`product.edit` -> `product`), or null for one not handled. */
function resourceOfEvent(eventName: string): ShoperWebhookResource | null {
  const prefix = eventName.toLowerCase().split('.')[0];
  if (prefix === SHOPER_WEBHOOK_ORDER_RESOURCE) {
    return SHOPER_WEBHOOK_ORDER_RESOURCE;
  }
  if (prefix === SHOPER_WEBHOOK_PRODUCT_RESOURCE) {
    return SHOPER_WEBHOOK_PRODUCT_RESOURCE;
  }
  return null;
}

/**
 * A delivery that names no event is classified by its body. An order body
 * carries `order_id` and a product body `product_id`; an order wins when both
 * are present, because an order's lines carry product ids too.
 */
function resourceOfBody(record: Record<string, unknown>): ShoperWebhookResource | null {
  if (record['order_id'] !== undefined) {
    return SHOPER_WEBHOOK_ORDER_RESOURCE;
  }
  if (record['product_id'] !== undefined) {
    return SHOPER_WEBHOOK_PRODUCT_RESOURCE;
  }
  return null;
}

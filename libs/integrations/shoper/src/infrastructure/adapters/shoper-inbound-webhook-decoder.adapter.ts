/**
 * Shoper Inbound Webhook Decoder Adapter (#3644, ADR-021)
 *
 * Authenticates and decodes Shoper order webhooks at the host ingress, keyed by
 * `provider = 'shoper'`.
 *
 * AUTHENTICATION: a token in the delivery URL (`?token=<secret>`), compared in
 * constant time with the per-connection webhook secret the host supplies. This
 * is not a signature, and the reason is a real gap rather than a shortcut:
 * Shoper signs deliveries with `x-webhook-sha1`, whose algorithm is unresolved
 * (13 candidates ruled out in SPIKE-3638 X5). What the token buys is that a
 * caller who merely learns a connection id cannot trigger re-reads. What it does
 * not buy is payload integrity - which is not load-bearing here, because the body
 * is never trusted (below). The token travels in the URL, so it can appear in
 * reverse-proxy / CDN / tunnel access logs; re-running webhook install rotates it. No timestamp is signed, so `verify` omits
 * `timestampMs` and the host's replay-window check never fires (the WooCommerce
 * and Erli posture).
 *
 * TRIGGER MODEL: the delivery carries the whole order, and the decoder reads only
 * its id. The authoritative order is re-read through `ShoperOrderSourceAdapter`
 * by the `marketplace.order.sync` job, so a forged or stale body can at worst
 * cause one redundant re-read.
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

import {
  SHOPER_WEBHOOK_NAME_HEADER,
  SHOPER_WEBHOOK_ORDER_RESOURCE,
  SHOPER_WEBHOOK_TOKEN_QUERY_KEY,
} from '../../domain/types/shoper-webhook.types';

/** Fallback when a delivery names no event: treated as an update, i.e. a safe re-read. */
const DEFAULT_EVENT = 'order.edit';

export class ShoperInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
    query?: Readonly<Record<string, string>>;
  }): WebhookVerifyResult {
    const provided = input.query?.[SHOPER_WEBHOOK_TOKEN_QUERY_KEY];
    if (typeof provided !== 'string' || provided.length === 0 || input.secret.length === 0) {
      return { ok: false };
    }
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(input.secret);
    // `timingSafeEqual` throws on a length mismatch, and the length of a random
    // secret is not itself worth hiding.
    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: false };
    }
    return { ok: true };
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

    const eventName = this.header(headers, SHOPER_WEBHOOK_NAME_HEADER);
    if (eventName !== undefined && !eventName.toLowerCase().startsWith(`${SHOPER_WEBHOOK_ORDER_RESOURCE}.`)) {
      // Authentic but not an order event (someone registered more events on the
      // shop): 202 without publish, so it does not become a retry storm.
      return { action: 'ignore', reason: `not an order event (${eventName})` };
    }

    const orderId = this.asId((body as Record<string, unknown>)['order_id']);
    if (orderId === null) {
      return { action: 'ignore', reason: 'body has no order id' };
    }

    const eventType = eventName ?? DEFAULT_EVENT;
    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(eventType, rawBody),
        eventType,
        // Advisory only: the body's timestamps are naive and shop-local.
        occurredAt: new Date().toISOString(),
        objectType: SHOPER_WEBHOOK_ORDER_RESOURCE,
        externalId: orderId,
        payload: { id: orderId },
      },
    };
  }

  /**
   * Deterministic dedup key: the event name plus the exact body. A retried
   * delivery re-hashes to the same id and is caught by the Postgres dedup gate; a
   * real change alters the body (`status_id`, `status_date`, `sum`, ...). The
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

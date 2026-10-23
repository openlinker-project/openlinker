/**
 * Shoper Inbound Webhook Decoder Adapter (#3644, ADR-021)
 *
 * Authenticates and decodes Shoper order webhooks at the host ingress, keyed by
 * `provider = 'shoper'`.
 *
 * AUTHENTICATION: two checks, BOTH required, over the one per-connection
 * webhook secret the host supplies:
 *   - the token in the delivery URL (`?token=<secret>`), constant-time; and
 *   - Shoper's signature, `x-webhook-sha1 = hex(sha1(webhook_id + ":" + secret +
 *     ":" + rawBody))`, with `webhook_id` taken from `x-webhook-id`, computed
 *     over the RAW body bytes and compared in constant time. Verified against
 *     12+ real deliveries (2026-10-23).
 * Before the signature was resolved the URL token was the only check, and a
 * delivery with a forged or missing `x-webhook-sha1` was accepted. The token is
 * kept as well because it costs nothing and a caller who learns only a webhook
 * id still has to know the secret twice over. Both values come from one secret
 * because the provisioner registers it as the URL token AND as the webhook's
 * `secret`, and has done so since #3644, so a webhook installed before the
 * signature check existed verifies without re-install. The token travels in
 * the URL, so it can appear in reverse-proxy / CDN / tunnel access logs;
 * re-running webhook install rotates it. No timestamp is signed, so `verify`
 * omits `timestampMs` and the host's replay-window check never fires (the
 * WooCommerce and Erli posture); a replayed delivery costs a redundant re-read
 * at worst, and the dedup gate catches an identical body.
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
  SHOPER_WEBHOOK_ID_HEADER,
  SHOPER_WEBHOOK_NAME_HEADER,
  SHOPER_WEBHOOK_SIGNATURE_HEADER,
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
    if (input.secret.length === 0) {
      return { ok: false };
    }
    const token = input.query?.[SHOPER_WEBHOOK_TOKEN_QUERY_KEY];
    if (typeof token !== 'string' || !constantTimeEquals(token, input.secret)) {
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

function constantTimeEquals(provided: string, expected: string): boolean {
  if (provided.length === 0) {
    return false;
  }
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, and the length of a random
  // secret or of a SHA-1 hex digest is not itself worth hiding.
  return providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
}

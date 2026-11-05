/**
 * Shopify Inbound Webhook Decoder Adapter (spike #3928, ADR-021)
 *
 * Authenticates and decodes Shopify order and product webhooks at the host
 * ingress, keyed by `provider = 'shopify'`. PROTOTYPE.
 *
 * AUTHENTICATION: `x-shopify-hmac-sha256 = base64(HMAC-SHA256(secret, rawBody))`,
 * where the secret is the app's CLIENT SECRET. Shopify chooses that key, not
 * OpenLinker, so the provisioner stores the client secret as the connection's
 * webhook secret and the host hands it back here. Compared in constant time over
 * the decoded digest bytes.
 *
 * REPLAY PROTECTION: `verify` deliberately returns no `timestampMs`. Shopify
 * retries a failed delivery for up to 48 hours with the SAME
 * `x-shopify-triggered-at`, so feeding it to the host's skew window (minutes)
 * would answer a legitimate retry with 401, and repeated failures make Shopify
 * delete the subscription. Replay protection is the Postgres dedup gate keyed
 * by `x-shopify-webhook-id`, which a replay repeats; and a webhook is only a
 * trigger, so a replay that got through costs one redundant re-read.
 *
 * TRIGGER MODEL: the body is the whole REST resource and only its id is read.
 * The authoritative order or product is re-read downstream (#904), so a stale
 * or reordered delivery cannot write anything.
 *
 * @module libs/integrations/shopify/src/infrastructure/adapters
 * @implements {InboundWebhookDecoderPort}
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';

import { fromShopifyGid } from '../../domain/policies/shopify-gid.policy';
import {
  SHOPIFY_WEBHOOK_HMAC_HEADER,
  SHOPIFY_WEBHOOK_ID_HEADER,
  SHOPIFY_WEBHOOK_TOPIC_HEADER,
  SHOPIFY_WEBHOOK_TRIGGERED_AT_HEADER,
  shopifyWebhookResourceOf,
} from '../../domain/types/shopify-webhook.types';

const NUMERIC_ID = /^\d+$/;

/**
 * Shopify ids can exceed `Number.MAX_SAFE_INTEGER`, which `JSON.parse` would
 * silently round. A delete body carries no GID, only `{"id": ...}` with `id`
 * serialised first, so the exact digits are read from the raw text instead.
 */
const LEADING_ID = /^\s*\{\s*"id"\s*:\s*(\d+)\s*[,}]/;

export class ShopifyInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
    query?: Readonly<Record<string, string>>;
  }): WebhookVerifyResult {
    if (input.secret.length === 0) {
      return { ok: false };
    }
    const provided = this.header(input.headers, SHOPIFY_WEBHOOK_HMAC_HEADER);
    if (provided === undefined) {
      return { ok: false };
    }
    const expected = createHmac('sha256', input.secret).update(input.rawBody).digest();
    // Base64 decoding never throws; garbage decodes to bytes of the wrong length or value.
    const providedBytes = Buffer.from(provided, 'base64');
    // `timingSafeEqual` throws on a length mismatch, and a digest's length is not secret.
    const ok = providedBytes.length === expected.length && timingSafeEqual(providedBytes, expected);
    return { ok };
  }

  extractEnvelope(rawBody: Buffer, headers: Record<string, string>): DecodeResult {
    const topic = this.header(headers, SHOPIFY_WEBHOOK_TOPIC_HEADER);
    if (topic === undefined) {
      return { action: 'reject', reason: `missing ${SHOPIFY_WEBHOOK_TOPIC_HEADER} header` };
    }
    const resource = shopifyWebhookResourceOf(topic);
    if (resource === null) {
      // Authentic but a topic OpenLinker does not subscribe to (someone added one
      // by hand): 202 without a job, so it cannot become a retry storm.
      return { action: 'ignore', reason: `not an order or product topic (${topic})` };
    }

    const text = rawBody.toString('utf8');
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { action: 'reject', reason: 'body is not valid JSON' };
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { action: 'reject', reason: 'body is not a JSON object' };
    }

    const id = this.resourceId(body as Record<string, unknown>, text);
    if (id === null) {
      return { action: 'ignore', reason: `body has no ${resource} id` };
    }

    const eventType = topic.trim().toLowerCase();
    return {
      action: 'route',
      envelope: {
        eventId: this.header(headers, SHOPIFY_WEBHOOK_ID_HEADER) ?? this.deriveEventId(eventType, rawBody),
        eventType,
        occurredAt: this.occurredAt(headers),
        objectType: resource,
        externalId: id,
        payload: { id },
      },
    };
  }

  /** The numeric id, read where it is exact: the GID first, then a safe number, then the raw text. */
  private resourceId(record: Record<string, unknown>, text: string): string | null {
    const gid = record['admin_graphql_api_id'];
    if (typeof gid === 'string') {
      const fromGid = fromShopifyGid(gid);
      if (NUMERIC_ID.test(fromGid) && fromGid !== '0') {
        return fromGid;
      }
    }
    const raw = record['id'];
    if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) {
      return String(raw);
    }
    if (typeof raw === 'string' && NUMERIC_ID.test(raw.trim()) && raw.trim() !== '0') {
      return raw.trim();
    }
    const leading = LEADING_ID.exec(text);
    return leading !== null && leading[1] !== '0' ? leading[1] : null;
  }

  /**
   * Fallback only, for a delivery without `x-shopify-webhook-id`: the topic plus
   * the exact body, so a replay of the same delivery maps to the same key.
   */
  private deriveEventId(eventType: string, rawBody: Buffer): string {
    return createHash('sha256').update(eventType).update(':').update(rawBody).digest('hex');
  }

  private occurredAt(headers: Record<string, string>): string {
    const triggeredAt = this.header(headers, SHOPIFY_WEBHOOK_TRIGGERED_AT_HEADER);
    const parsed = triggeredAt === undefined ? Number.NaN : Date.parse(triggeredAt);
    return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
  }

  private header(headers: Record<string, string>, name: string): string | undefined {
    // Node lower-cases header names, but a caller may hand them over in any case.
    const wanted = name.toLowerCase();
    const match = Object.entries(headers).find(([key]) => key.toLowerCase() === wanted);
    const value = match?.[1];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }
}

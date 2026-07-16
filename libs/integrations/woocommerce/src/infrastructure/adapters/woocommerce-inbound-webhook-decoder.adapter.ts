/**
 * WooCommerce Inbound Webhook Decoder Adapter (#1563, ADR-021)
 *
 * Authenticates + decodes WooCommerce inbound order webhooks at the host
 * ingress, keyed by `provider = 'woocommerce'`. The deferred second half of
 * #1548 (acceptance criterion 4): the provisioning adapter (#1548) already
 * registers the store-side `order.created` / `order.updated` webhooks and
 * rotates the shared secret; this decoder lets the host authenticate the
 * resulting deliveries instead of dropping them on the host default decoder
 * (`DefaultWebhookDecoder`, which expects OpenLinker's own HMAC scheme).
 *
 * SIGNATURE: WooCommerce signs each delivery with
 * `X-WC-Webhook-Signature: <base64(HMAC-SHA256(rawBody))>`, keyed by the
 * per-connection webhook secret (`IWebhookSecretService`, provider key
 * `woocommerce`) the host supplies to `verify`. WooCommerce sends NO signed
 * timestamp header, so `verify` omits `timestampMs` and the host's shared
 * replay-window check never fires (same posture as `ErliInboundWebhookDecoderAdapter`).
 *
 * TRIGGER MODEL: the webhook is a low-latency nudge, never the source of truth
 * (`WooCommerceOrderSourceAdapter` remains the reconciliation backstop). The
 * decoder reads only the order id + a coarse event type from the body/headers;
 * the authoritative order is re-pulled downstream by the `marketplace.order.sync`
 * job. The event vocabulary lives in `WooCommerceWebhookEventTranslatorAdapter`,
 * which accepts either the full WC topic (`order.created`) or its bare action.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters
 * @see {@link InboundWebhookDecoderPort} for the port interface
 * @see {@link WooCommerceWebhookProvisioningAdapter} for the provisioner that sets the secret
 * @see {@link WooCommerceWebhookEventTranslatorAdapter} for the downstream translator
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DecodeResult,
  InboundWebhookDecoderPort,
  WebhookVerifyResult,
} from '@openlinker/core/integrations';
import {
  WOOCOMMERCE_WEBHOOK_EVENT_HEADER,
  WOOCOMMERCE_WEBHOOK_ORDER_RESOURCE,
  WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER,
  WOOCOMMERCE_WEBHOOK_TOPIC_HEADER,
} from './woocommerce-webhook.types';

export class WooCommerceInboundWebhookDecoderAdapter implements InboundWebhookDecoderPort {
  verify(input: {
    rawBody: Buffer;
    headers: Record<string, string>;
    secret: string;
  }): WebhookVerifyResult {
    const provided = this.header(input.headers, WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER);
    if (!provided) {
      return { ok: false };
    }

    const expected = createHmac('sha256', input.secret).update(input.rawBody).digest('base64');
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(expected);
    if (providedBuf.length !== expectedBuf.length) {
      return { ok: false };
    }
    if (!timingSafeEqual(providedBuf, expectedBuf)) {
      return { ok: false };
    }

    // WooCommerce does not send a signed timestamp header, so `timestampMs` is
    // omitted intentionally — the host's replay-window check only fires when
    // the field is present.
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
    const record = body as Record<string, unknown>;

    const orderId = this.asId(record['id']);
    if (!orderId) {
      // No order id — e.g. WooCommerce's creation "ping" (`{ webhook_id: N }`),
      // which is signed but is not an order event. Well-formed but not ours:
      // 202 without publish, so it does not trigger a source-side retry storm.
      return { action: 'ignore', reason: 'body has no order id (ping or non-order delivery)' };
    }

    const eventType = this.resolveEventType(headers);
    const bodyTimestamp = this.resolveBodyTimestamp(record);
    const occurredAt = bodyTimestamp ?? new Date().toISOString();

    return {
      action: 'route',
      envelope: {
        eventId: this.deriveEventId(record, orderId, eventType, bodyTimestamp),
        eventType,
        occurredAt,
        objectType: WOOCOMMERCE_WEBHOOK_ORDER_RESOURCE,
        externalId: orderId,
        payload: { id: orderId },
      },
    };
  }

  /**
   * The full WC topic (`order.created` / `order.updated`) from the delivery
   * header, or `order.<event>` rebuilt from the bare action header, or a safe
   * `order.updated` fallback. The translator accepts all three forms and coerces
   * anything that is not a create to a re-pull.
   */
  private resolveEventType(headers: Record<string, string>): string {
    const topic = this.header(headers, WOOCOMMERCE_WEBHOOK_TOPIC_HEADER);
    if (topic) {
      return topic;
    }
    const event = this.header(headers, WOOCOMMERCE_WEBHOOK_EVENT_HEADER);
    if (event) {
      return `${WOOCOMMERCE_WEBHOOK_ORDER_RESOURCE}.${event}`;
    }
    return `${WOOCOMMERCE_WEBHOOK_ORDER_RESOURCE}.updated`;
  }

  /**
   * Deterministic dedup key. The hash basis folds in `status`, the event type,
   * and the body's own modified timestamp so successive real changes of one
   * order (created -> processing -> completed) hash distinctly, while a retried
   * delivery of the identical body re-hashes to the same eventId and is caught
   * by the Postgres eventId-dedup gate. The decode-time `now` fallback used for
   * the advisory `occurredAt` is intentionally NOT part of the basis — hashing
   * it would mint a fresh eventId on every retry and defeat dedup.
   */
  private deriveEventId(
    record: Record<string, unknown>,
    orderId: string,
    eventType: string,
    bodyTimestamp: string | null,
  ): string {
    const status = this.asNonEmptyString(record['status']) ?? 'no-status';
    const timestamp = bodyTimestamp ?? 'no-timestamp';
    const basis = `${orderId}:${status}:${eventType}:${timestamp}`;
    return `woocommerce-${createHash('sha256').update(basis).digest('hex').slice(0, 32)}`;
  }

  private resolveBodyTimestamp(record: Record<string, unknown>): string | null {
    return (
      this.asNonEmptyString(record['date_modified_gmt']) ??
      this.asNonEmptyString(record['date_modified']) ??
      this.asNonEmptyString(record['date_created_gmt']) ??
      this.asNonEmptyString(record['date_created'])
    );
  }

  private header(headers: Record<string, string>, name: string): string | null {
    const lower = name.toLowerCase();
    const entry = Object.entries(headers).find(([k]) => k.toLowerCase() === lower);
    const value = entry?.[1];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
  }

  /** Accept WooCommerce's numeric order id (or a stringified one); reject 0 / empty. */
  private asId(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return String(value);
    }
    return this.asNonEmptyString(value);
  }

  private asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
}

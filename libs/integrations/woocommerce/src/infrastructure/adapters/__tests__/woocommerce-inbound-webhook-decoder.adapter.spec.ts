/**
 * Unit tests for WooCommerceInboundWebhookDecoderAdapter (#1563, ADR-021).
 *
 * WooCommerce signs each delivery with a base64 HMAC-SHA256 of the raw body in
 * the `X-WC-Webhook-Signature` header (no signed timestamp), and delivers the
 * full order resource as the body. Tests exercise the real HMAC so a wire
 * change surfaces here rather than in production.
 */
import { createHmac } from 'node:crypto';
import { WooCommerceInboundWebhookDecoderAdapter } from '../woocommerce-inbound-webhook-decoder.adapter';
import {
  WOOCOMMERCE_WEBHOOK_EVENT_HEADER,
  WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER,
  WOOCOMMERCE_WEBHOOK_TOPIC_HEADER,
} from '../woocommerce-webhook.types';

const SECRET = 'wc-connection-webhook-secret-ol-side';
const ORDER_ID = 4321;

function makeBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      id: ORDER_ID,
      status: 'processing',
      date_modified_gmt: '2026-07-16T10:00:00',
      ...overrides,
    }),
  );
}

function sign(rawBody: Buffer, secret: string = SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

function deliveryHeaders(rawBody: Buffer, extra: Record<string, string> = {}): Record<string, string> {
  return {
    [WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER]: sign(rawBody),
    [WOOCOMMERCE_WEBHOOK_TOPIC_HEADER]: 'order.updated',
    ...extra,
  };
}

describe('WooCommerceInboundWebhookDecoderAdapter', () => {
  let decoder: WooCommerceInboundWebhookDecoderAdapter;

  beforeEach(() => {
    decoder = new WooCommerceInboundWebhookDecoderAdapter();
  });

  // ---------------------------------------------------------------------------
  // verify()
  // ---------------------------------------------------------------------------

  describe('verify', () => {
    it('should accept a correctly-signed delivery', () => {
      const rawBody = makeBody();
      const result = decoder.verify({
        rawBody,
        headers: { [WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER]: sign(rawBody) },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept the signature header in any casing', () => {
      const rawBody = makeBody();
      const result = decoder.verify({
        rawBody,
        headers: { 'X-WC-Webhook-Signature': sign(rawBody) },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject a signature computed with the wrong secret', () => {
      const rawBody = makeBody();
      const result = decoder.verify({
        rawBody,
        headers: { [WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER]: sign(rawBody, 'wrong-secret') },
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the body was tampered with after signing', () => {
      const signed = makeBody();
      const tampered = makeBody({ status: 'completed' });
      const result = decoder.verify({
        rawBody: tampered,
        headers: { [WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER]: sign(signed) },
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the signature header is missing', () => {
      const result = decoder.verify({ rawBody: makeBody(), headers: {}, secret: SECRET });
      expect(result.ok).toBe(false);
    });

    it('should never surface a normalized timestamp (WooCommerce sends none)', () => {
      const rawBody = makeBody();
      const result = decoder.verify({
        rawBody,
        headers: { [WOOCOMMERCE_WEBHOOK_SIGNATURE_HEADER]: sign(rawBody) },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
      expect(result.timestampMs).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // extractEnvelope()
  // ---------------------------------------------------------------------------

  describe('extractEnvelope', () => {
    it('should route an order delivery with a neutral envelope', () => {
      const rawBody = makeBody();
      const result = decoder.extractEnvelope(rawBody, deliveryHeaders(rawBody));
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.objectType).toBe('order');
      expect(result.envelope.externalId).toBe(String(ORDER_ID));
      expect(result.envelope.eventType).toBe('order.updated');
      expect(result.envelope.occurredAt).toBe('2026-07-16T10:00:00');
      expect(result.envelope.payload).toEqual({ id: String(ORDER_ID) });
      expect(result.envelope.eventId).toMatch(/^woocommerce-[0-9a-f]{32}$/);
    });

    it('should carry the full topic header verbatim as eventType', () => {
      const rawBody = makeBody();
      const result = decoder.extractEnvelope(
        rawBody,
        deliveryHeaders(rawBody, { [WOOCOMMERCE_WEBHOOK_TOPIC_HEADER]: 'order.created' }),
      );
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.eventType).toBe('order.created');
    });

    it('should rebuild eventType from the bare action header when topic is absent', () => {
      const rawBody = makeBody();
      const result = decoder.extractEnvelope(rawBody, {
        [WOOCOMMERCE_WEBHOOK_EVENT_HEADER]: 'created',
      });
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.eventType).toBe('order.created');
    });

    it('should fall back to order.updated when no topic/event header is present', () => {
      const rawBody = makeBody();
      const result = decoder.extractEnvelope(rawBody, {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.eventType).toBe('order.updated');
    });

    it('should ignore the creation ping (body has no order id)', () => {
      const rawBody = Buffer.from(JSON.stringify({ webhook_id: 99 }));
      const result = decoder.extractEnvelope(rawBody, {});
      expect(result.action).toBe('ignore');
    });

    it('should reject a non-JSON body', () => {
      const result = decoder.extractEnvelope(Buffer.from('not-json'), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a JSON body that is not an object', () => {
      const result = decoder.extractEnvelope(Buffer.from(JSON.stringify(['array'])), {});
      expect(result.action).toBe('reject');
    });

    it('should derive an identical eventId for a retried identical delivery', () => {
      const rawBody = makeBody();
      const headers = deliveryHeaders(rawBody);
      const first = decoder.extractEnvelope(rawBody, headers);
      const second = decoder.extractEnvelope(rawBody, headers);
      expect(first.action).toBe('route');
      expect(second.action).toBe('route');
      if (first.action !== 'route' || second.action !== 'route') return;
      expect(first.envelope.eventId).toBe(second.envelope.eventId);
    });

    it('should derive a distinct eventId across a real status change', () => {
      const created = makeBody({ status: 'processing', date_modified_gmt: '2026-07-16T10:00:00' });
      const completed = makeBody({ status: 'completed', date_modified_gmt: '2026-07-16T11:00:00' });
      const a = decoder.extractEnvelope(created, deliveryHeaders(created));
      const b = decoder.extractEnvelope(completed, deliveryHeaders(completed));
      if (a.action !== 'route' || b.action !== 'route') throw new Error('expected route');
      expect(a.envelope.eventId).not.toBe(b.envelope.eventId);
    });
  });
});

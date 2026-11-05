import { createHmac } from 'node:crypto';

import { ShopifyInboundWebhookDecoderAdapter } from './shopify-inbound-webhook-decoder.adapter';

const SECRET = 'shpss_client_secret';

function sign(body: Buffer, secret = SECRET): string {
  return createHmac('sha256', secret).update(body).digest('base64');
}

function headersFor(topic: string, body: Buffer, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-shopify-topic': topic,
    'x-shopify-hmac-sha256': sign(body),
    'x-shopify-webhook-id': 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043',
    'x-shopify-triggered-at': '2026-11-05T10:00:00.000Z',
    ...extra,
  };
}

describe('ShopifyInboundWebhookDecoderAdapter', () => {
  const decoder = new ShopifyInboundWebhookDecoderAdapter();
  const orderBody = Buffer.from(
    JSON.stringify({ id: 5512345678901, admin_graphql_api_id: 'gid://shopify/Order/5512345678901', name: '#1001' }),
  );

  describe('verify', () => {
    it('should accept a delivery when the HMAC matches the raw body', () => {
      expect(decoder.verify({ rawBody: orderBody, headers: headersFor('orders/create', orderBody), secret: SECRET })).toEqual({
        ok: true,
      });
    });

    it('should reject a delivery when the body was tampered with', () => {
      const headers = headersFor('orders/create', orderBody);
      const tampered = Buffer.from(orderBody.toString('utf8').replace('#1001', '#1002'));
      expect(decoder.verify({ rawBody: tampered, headers, secret: SECRET }).ok).toBe(false);
    });

    it('should reject a delivery when the HMAC header is missing', () => {
      const headers = headersFor('orders/create', orderBody);
      delete headers['x-shopify-hmac-sha256'];
      expect(decoder.verify({ rawBody: orderBody, headers, secret: SECRET }).ok).toBe(false);
    });

    it('should reject a delivery when the secret is empty', () => {
      const headers = { ...headersFor('orders/create', orderBody), 'x-shopify-hmac-sha256': sign(orderBody, '') };
      expect(decoder.verify({ rawBody: orderBody, headers, secret: '' }).ok).toBe(false);
    });

    it('should never return a timestamp when a delivery is valid', () => {
      const result = decoder.verify({ rawBody: orderBody, headers: headersFor('orders/create', orderBody), secret: SECRET });
      expect(result.timestampMs).toBeUndefined();
    });
  });

  describe('extractEnvelope', () => {
    it('should route an order using the webhook id as the event id when the topic is orders/create', () => {
      const result = decoder.extractEnvelope(orderBody, headersFor('orders/create', orderBody));
      expect(result).toEqual({
        action: 'route',
        envelope: {
          eventId: 'b54557e4-bdd9-4b37-8a5f-bf7d70bcd043',
          eventType: 'orders/create',
          occurredAt: '2026-11-05T10:00:00.000Z',
          objectType: 'order',
          externalId: '5512345678901',
          payload: { id: '5512345678901' },
        },
      });
    });

    it('should route a product when the topic is products/update', () => {
      const body = Buffer.from(JSON.stringify({ id: 9001, admin_graphql_api_id: 'gid://shopify/Product/9001' }));
      const result = decoder.extractEnvelope(body, headersFor('products/update', body));
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.objectType).toBe('product');
        expect(result.envelope.externalId).toBe('9001');
      }
    });

    it('should keep every digit of an id above the safe integer range when the body has no GID', () => {
      const body = Buffer.from('{"id":788032119674292922}');
      const result = decoder.extractEnvelope(body, headersFor('products/delete', body));
      expect(result.action === 'route' && result.envelope.externalId).toBe('788032119674292922');
    });

    it('should ignore the delivery when the topic is not handled', () => {
      const body = Buffer.from(JSON.stringify({ id: 1 }));
      expect(decoder.extractEnvelope(body, headersFor('customers/create', body)).action).toBe('ignore');
    });

    it('should hash topic and body into the event id when the webhook id header is missing', () => {
      const headers = headersFor('orders/updated', orderBody);
      delete headers['x-shopify-webhook-id'];
      const first = decoder.extractEnvelope(orderBody, headers);
      const second = decoder.extractEnvelope(orderBody, headers);
      expect(first.action === 'route' && first.envelope.eventId).toMatch(/^[0-9a-f]{64}$/);
      expect(first).toEqual(second);
    });
  });
});

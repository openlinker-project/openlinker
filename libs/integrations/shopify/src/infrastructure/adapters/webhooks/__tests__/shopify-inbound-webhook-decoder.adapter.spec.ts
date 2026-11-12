import { createHmac } from 'node:crypto';

import { ShopifyInboundWebhookDecoderAdapter } from '../shopify-inbound-webhook-decoder.adapter';

const SECRET = 'client-secret';

function sign(body: string, secret = SECRET): string {
  return createHmac('sha256', secret).update(Buffer.from(body)).digest('base64');
}

function headers(topic: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    'x-shopify-topic': topic,
    'x-shopify-webhook-id': 'wh-1',
    'x-shopify-triggered-at': '2026-11-10T10:00:00.000Z',
    ...extra,
  };
}

describe('ShopifyInboundWebhookDecoderAdapter', () => {
  const decoder = new ShopifyInboundWebhookDecoderAdapter();
  const body = '{"id":820982911946154500,"admin_graphql_api_id":"gid://shopify/Order/820982911946154508"}';

  describe('verify', () => {
    it('should accept a body signed with the client secret and report no timestamp', () => {
      expect(
        decoder.verify({ rawBody: Buffer.from(body), headers: { 'X-Shopify-Hmac-Sha256': sign(body) }, secret: SECRET }),
      ).toEqual({ ok: true });
    });

    it('should refuse a signature made with another secret', () => {
      expect(
        decoder.verify({
          rawBody: Buffer.from(body),
          headers: { 'x-shopify-hmac-sha256': sign(body, 'other') },
          secret: SECRET,
        }).ok,
      ).toBe(false);
    });

    it('should refuse a body changed after signing', () => {
      expect(
        decoder.verify({
          rawBody: Buffer.from(`${body} `),
          headers: { 'x-shopify-hmac-sha256': sign(body) },
          secret: SECRET,
        }).ok,
      ).toBe(false);
    });

    it('should refuse a missing or malformed signature without throwing', () => {
      expect(decoder.verify({ rawBody: Buffer.from(body), headers: {}, secret: SECRET }).ok).toBe(false);
      expect(
        decoder.verify({ rawBody: Buffer.from(body), headers: { 'x-shopify-hmac-sha256': 'not base64!' }, secret: SECRET })
          .ok,
      ).toBe(false);
    });

    it('should refuse everything when no secret is stored', () => {
      expect(
        decoder.verify({ rawBody: Buffer.from(body), headers: { 'x-shopify-hmac-sha256': sign(body, '') }, secret: '' })
          .ok,
      ).toBe(false);
    });
  });

  describe('extractEnvelope', () => {
    it('should route an order with the exact id from the GID and the webhook id as the event id', () => {
      expect(decoder.extractEnvelope(Buffer.from(body), headers('orders/create'))).toEqual({
        action: 'route',
        envelope: {
          eventId: 'wh-1',
          eventType: 'orders/create',
          occurredAt: '2026-11-10T10:00:00.000Z',
          objectType: 'order',
          externalId: '820982911946154508',
          payload: { id: '820982911946154508' },
        },
      });
    });

    it('should read the exact digits of a large id from a delete body that carries no GID', () => {
      const result = decoder.extractEnvelope(Buffer.from('{"id":9007199254740993}'), headers('products/delete'));

      expect(result).toMatchObject({ action: 'route', envelope: { objectType: 'product', externalId: '9007199254740993' } });
    });

    it('should ignore a topic OpenLinker does not handle', () => {
      expect(decoder.extractEnvelope(Buffer.from(body), headers('customers/create'))).toMatchObject({
        action: 'ignore',
      });
    });

    it('should reject a delivery without a topic or with a body that is not an object', () => {
      expect(decoder.extractEnvelope(Buffer.from(body), {})).toMatchObject({ action: 'reject' });
      expect(decoder.extractEnvelope(Buffer.from('not json'), headers('orders/create'))).toMatchObject({
        action: 'reject',
      });
      expect(decoder.extractEnvelope(Buffer.from('[1]'), headers('orders/create'))).toMatchObject({
        action: 'reject',
      });
    });

    it('should ignore a body with no usable id', () => {
      expect(decoder.extractEnvelope(Buffer.from('{"name":"x"}'), headers('orders/updated'))).toMatchObject({
        action: 'ignore',
      });
    });

    it('should derive a stable event id when the webhook id header is missing', () => {
      const plain = { 'x-shopify-topic': 'orders/updated' };
      const eventIdOf = (raw: string): string | null => {
        const result = decoder.extractEnvelope(Buffer.from(raw), plain);
        return result.action === 'route' ? result.envelope.eventId : null;
      };

      expect(eventIdOf(body)).toMatch(/^[0-9a-f]{64}$/);
      expect(eventIdOf(body)).toBe(eventIdOf(body));
      expect(eventIdOf(body)).not.toBe(eventIdOf('{"id":5}'));
    });
  });
});

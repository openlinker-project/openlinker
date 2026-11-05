import type { InboundWebhookEvent } from '@openlinker/core/events';

import { ShopifyWebhookEventTranslatorAdapter } from './shopify-webhook-event-translator.adapter';

function event(objectType: string, eventType: string): InboundWebhookEvent {
  return {
    eventId: 'webhook-1',
    provider: 'shopify',
    connectionId: 'conn-1',
    eventType,
    occurredAt: '2026-11-05T10:00:00.000Z',
    receivedAt: '2026-11-05T10:00:01.000Z',
    objectType,
    externalId: '42',
    payload: { id: '42' },
  };
}

describe('ShopifyWebhookEventTranslatorAdapter', () => {
  const translator = new ShopifyWebhookEventTranslatorAdapter();

  it('should translate orders/create into a created order event', () => {
    expect(translator.translate(event('order', 'orders/create'))).toMatchObject({
      domain: 'order',
      eventType: 'created',
      externalId: '42',
    });
  });

  it.each(['orders/updated', 'orders/cancelled'])('should translate %s into an updated order event', (topic) => {
    expect(translator.translate(event('order', topic))).toMatchObject({ domain: 'order', eventType: 'updated' });
  });

  it('should fan products/update out into a product and an inventory event', () => {
    const translated = translator.translate(event('product', 'products/update'));
    expect(Array.isArray(translated) && translated.map((e) => e.domain)).toEqual(['product', 'inventory']);
  });

  it('should translate products/delete into a single product event', () => {
    expect(translator.translate(event('product', 'products/delete'))).toMatchObject({
      domain: 'product',
      externalId: '42',
    });
  });

  it('should return null when the object type is unknown', () => {
    expect(translator.translate(event('customer', 'customers/create'))).toBeNull();
  });
});

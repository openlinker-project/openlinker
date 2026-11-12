import type { InboundWebhookEvent } from '@openlinker/core/events';

import { ShopifyWebhookEventTranslatorAdapter } from '../shopify-webhook-event-translator.adapter';

function event(eventType: string, objectType: string): InboundWebhookEvent {
  return {
    eventType,
    objectType,
    externalId: '77',
    occurredAt: '2026-11-10T10:00:00.000Z',
    payload: { id: '77' },
  } as unknown as InboundWebhookEvent;
}

describe('ShopifyWebhookEventTranslatorAdapter', () => {
  const translator = new ShopifyWebhookEventTranslatorAdapter();

  it('should turn orders/create into a created order event', () => {
    expect(translator.translate(event('orders/create', 'order'))).toEqual({
      domain: 'order',
      externalId: '77',
      eventType: 'created',
      occurredAt: '2026-11-10T10:00:00.000Z',
      payload: { id: '77' },
    });
  });

  it('should turn every other order topic, a cancellation included, into an updated order event', () => {
    expect(translator.translate(event('orders/cancelled', 'order'))).toMatchObject({ domain: 'order', eventType: 'updated' });
    expect(translator.translate(event('orders/updated', 'order'))).toMatchObject({ domain: 'order', eventType: 'updated' });
  });

  it('should turn products/update into a product and an inventory event for the same product', () => {
    expect(translator.translate(event('products/update', 'product'))).toEqual([
      expect.objectContaining({ domain: 'product', externalId: '77' }),
      expect.objectContaining({ domain: 'inventory', externalId: '77' }),
    ]);
  });

  it('should turn products/create and products/delete into a product event only', () => {
    expect(translator.translate(event('products/create', 'product'))).toMatchObject({ domain: 'product' });
    expect(translator.translate(event('products/delete', 'product'))).toMatchObject({ domain: 'product' });
  });

  it('should return null for an object type it does not know', () => {
    expect(translator.translate(event('customers/create', 'customer'))).toBeNull();
  });
});

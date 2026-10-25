import type { InboundWebhookEvent } from '@openlinker/core/events';
import type { CanonicalInboundEvent } from '@openlinker/core/integrations';

import { ShoperWebhookEventTranslatorAdapter } from '../shoper-webhook-event-translator.adapter';

function event(overrides: Partial<InboundWebhookEvent> = {}): InboundWebhookEvent {
  return {
    eventId: 'e1',
    provider: 'shoper',
    connectionId: 'c1',
    eventType: 'order.edit',
    occurredAt: '2026-10-06T10:00:00.000Z',
    objectType: 'order',
    externalId: '8',
    payload: { id: '8' },
    ...overrides,
  } as InboundWebhookEvent;
}

/** Order events never fan out; narrow the translator's answer to the single event. */
function single(
  translated: CanonicalInboundEvent | CanonicalInboundEvent[] | null,
): CanonicalInboundEvent | null {
  if (Array.isArray(translated)) {
    throw new Error(`expected a single event, got ${translated.length}`);
  }
  return translated;
}

describe('ShoperWebhookEventTranslatorAdapter', () => {
  const translator = new ShoperWebhookEventTranslatorAdapter();

  it('should translate an order event into the order domain, keeping the id and payload', () => {
    expect(translator.translate(event())).toEqual({
      domain: 'order',
      externalId: '8',
      eventType: 'updated',
      occurredAt: '2026-10-06T10:00:00.000Z',
      payload: { id: '8' },
    });
  });

  it.each([
    ['order.create', 'created'],
    ['ORDER.CREATE', 'created'],
    ['order.edit', 'updated'],
    ['order.paid', 'updated'],
    ['order.status', 'updated'],
    ['something.else', 'updated'],
  ])('should map the event %s to %s', (eventType, expected) => {
    expect(single(translator.translate(event({ eventType })))?.eventType).toBe(expected);
  });

  it('should NOT infer a cancellation from the event name: that comes from the re-read order', () => {
    expect(single(translator.translate(event({ eventType: 'order.delete' })))?.eventType).toBe(
      'updated',
    );
  });

  it('should read the object type case-insensitively', () => {
    expect(translator.translate(event({ objectType: 'Order' }))).not.toBeNull();
  });

  it.each([['product.create'], ['product.delete']])(
    'should translate %s into the product domain alone, so it routes to a single product re-read',
    (eventType) => {
      expect(
        translator.translate(
          event({ objectType: 'product', eventType, externalId: '23', payload: { id: '23' } }),
        ),
      ).toEqual({
        domain: 'product',
        externalId: '23',
        eventType,
        occurredAt: '2026-10-06T10:00:00.000Z',
        payload: { id: '23' },
      });
    },
  );

  it.each([['product.edit'], ['PRODUCT.EDIT']])(
    'should fan %s out into a product event first and an inventory event second, because a stock edit arrives as the same event',
    (eventType) => {
      expect(
        translator.translate(
          event({ objectType: 'product', eventType, externalId: '23', payload: { id: '23' } }),
        ),
      ).toEqual([
        {
          domain: 'product',
          externalId: '23',
          eventType,
          occurredAt: '2026-10-06T10:00:00.000Z',
          payload: { id: '23' },
        },
        {
          domain: 'inventory',
          externalId: '23',
          eventType,
          occurredAt: '2026-10-06T10:00:00.000Z',
          payload: { id: '23' },
        },
      ]);
    },
  );

  it('should dead-letter an object type this plugin cannot decode', () => {
    expect(translator.translate(event({ objectType: 'client' }))).toBeNull();
  });
});

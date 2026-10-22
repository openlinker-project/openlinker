import type { InboundWebhookEvent } from '@openlinker/core/events';

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
    expect(translator.translate(event({ eventType }))?.eventType).toBe(expected);
  });

  it('should NOT infer a cancellation from the event name: that comes from the re-read order', () => {
    expect(translator.translate(event({ eventType: 'order.delete' }))?.eventType).toBe('updated');
  });

  it('should read the object type case-insensitively', () => {
    expect(translator.translate(event({ objectType: 'Order' }))).not.toBeNull();
  });

  it('should dead-letter an object type this plugin cannot decode', () => {
    expect(translator.translate(event({ objectType: 'client' }))).toBeNull();
  });
});

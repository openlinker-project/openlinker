/**
 * Erli Webhook Event Translator Adapter Tests (#996)
 *
 * Asserts the translator maps Erli's id-only order webhooks onto neutral
 * CanonicalInboundEvents, and is TOTAL — malformed / unknown input returns
 * `null` (→ dead-letter) and never throws. Fixtures are obviously-fake
 * (#992-PROVISIONAL wire shape).
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { ErliWebhookEventTranslator } from '../erli-webhook-event-translator.adapter';

function makeEvent(overrides: Partial<InboundWebhookEvent> = {}): InboundWebhookEvent {
  return {
    eventId: 'evt-fake-1',
    provider: 'erli',
    connectionId: 'conn-erli-fake',
    eventType: 'orderCreated',
    occurredAt: '2026-06-16T10:00:00.000Z',
    receivedAt: '2026-06-16T10:00:01.000Z',
    objectType: 'order',
    externalId: 'erli-order-fake-123',
    payload: { id: 'erli-order-fake-123' },
    ...overrides,
  };
}

describe('ErliWebhookEventTranslator', () => {
  let translator: ErliWebhookEventTranslator;

  beforeEach(() => {
    translator = new ErliWebhookEventTranslator();
  });

  it('should map orderCreated to a created order event', () => {
    const result = translator.translate(makeEvent({ eventType: 'orderCreated' }));

    expect(result).toEqual({
      domain: 'order',
      externalId: 'erli-order-fake-123',
      eventType: 'created',
      occurredAt: '2026-06-16T10:00:00.000Z',
      payload: { id: 'erli-order-fake-123' },
    });
  });

  it('should map orderStatusChanged to an updated order event', () => {
    const result = translator.translate(makeEvent({ eventType: 'orderStatusChanged' }));

    expect(result).toMatchObject({ domain: 'order', eventType: 'updated' });
  });

  it('should fall back to the payload order-id field when externalId is empty', () => {
    const result = translator.translate(
      makeEvent({ externalId: '', payload: { id: 'erli-order-fake-999' } }),
    );

    expect(result).toMatchObject({ domain: 'order', externalId: 'erli-order-fake-999' });
  });

  it('should pass occurredAt and payload through unchanged', () => {
    const result = translator.translate(
      makeEvent({ occurredAt: '2026-01-01T00:00:00.000Z', payload: { id: 'x-1', extra: 7 } }),
    );

    expect(result?.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result?.payload).toEqual({ id: 'x-1', extra: 7 });
  });

  it('should return null for an unknown event type without throwing', () => {
    expect(() => translator.translate(makeEvent({ eventType: 'orderArchived' }))).not.toThrow();
    expect(translator.translate(makeEvent({ eventType: 'orderArchived' }))).toBeNull();
  });

  it('should return null when the order id is missing (no externalId, no payload id)', () => {
    const result = translator.translate(
      makeEvent({ externalId: '', payload: {} }),
    );

    expect(result).toBeNull();
  });

  it('should return null when the order id is a blank / whitespace string', () => {
    const result = translator.translate(makeEvent({ externalId: '   ', payload: { id: '  ' } }));

    expect(result).toBeNull();
  });

  it('should return null when the payload order id is not a string', () => {
    const result = translator.translate(
      makeEvent({
        externalId: '',
        payload: { id: 42 as unknown as string },
      }),
    );

    expect(result).toBeNull();
  });

  it('should trim a padded order id', () => {
    const result = translator.translate(makeEvent({ externalId: '  erli-order-trim  ' }));

    expect(result?.externalId).toBe('erli-order-trim');
  });

  it('should not throw on a malformed event missing payload', () => {
    const malformed = makeEvent({ externalId: '' });
    delete (malformed as { payload?: unknown }).payload;

    expect(() => translator.translate(malformed)).not.toThrow();
    expect(translator.translate(malformed)).toBeNull();
  });
});

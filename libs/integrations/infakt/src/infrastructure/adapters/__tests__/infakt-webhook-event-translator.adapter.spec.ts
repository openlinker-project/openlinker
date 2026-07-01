/**
 * Infakt Webhook Event Translator Adapter — unit tests
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { InfaktWebhookEventTranslatorAdapter } from '../infakt-webhook-event-translator.adapter';

function event(overrides: Partial<InboundWebhookEvent> = {}): InboundWebhookEvent {
  return {
    eventId: 'e-1',
    provider: 'infakt',
    connectionId: 'conn-1',
    eventType: 'send_to_ksef_success',
    occurredAt: '2026-06-30T10:00:00Z',
    receivedAt: '2026-06-30T10:00:01Z',
    objectType: 'invoice',
    externalId: 'inv-1',
    payload: { status: 'success' },
    ...overrides,
  };
}

describe('InfaktWebhookEventTranslatorAdapter', () => {
  let translator: InfaktWebhookEventTranslatorAdapter;

  beforeEach(() => {
    translator = new InfaktWebhookEventTranslatorAdapter();
  });

  it('should translate a send_to_ksef_success event to the invoicing domain', () => {
    expect(translator.translate(event())).toEqual({
      domain: 'invoicing',
      externalId: 'inv-1',
      eventType: 'send_to_ksef_success',
      occurredAt: '2026-06-30T10:00:00Z',
      payload: { status: 'success' },
    });
  });

  it('should translate a send_to_ksef_error event to the invoicing domain', () => {
    expect(translator.translate(event({ eventType: 'send_to_ksef_error' }))?.domain).toBe('invoicing');
  });

  it('should return null for a non-KSeF invoice event (dead-letter)', () => {
    expect(translator.translate(event({ eventType: 'draft_invoice_created' }))).toBeNull();
  });

  it('should return null for a non-invoice object type', () => {
    expect(translator.translate(event({ objectType: 'order' }))).toBeNull();
  });
});

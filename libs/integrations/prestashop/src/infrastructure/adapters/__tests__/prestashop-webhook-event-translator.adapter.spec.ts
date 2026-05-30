/**
 * PrestaShop Webhook Event Translator Adapter Unit Tests
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { PrestashopWebhookEventTranslatorAdapter } from '../prestashop-webhook-event-translator.adapter';

describe('PrestashopWebhookEventTranslatorAdapter', () => {
  const translator = new PrestashopWebhookEventTranslatorAdapter();

  const event = (overrides: Partial<InboundWebhookEvent>): InboundWebhookEvent => ({
    eventId: 'evt-1',
    provider: 'prestashop',
    connectionId: 'conn-1',
    eventType: 'order.created',
    occurredAt: '2026-01-01T00:00:00.000Z',
    receivedAt: '2026-01-01T00:00:01.000Z',
    objectType: 'order',
    externalId: '42',
    payload: {},
    ...overrides,
  });

  it('should translate order.created to the order domain with created', () => {
    const result = translator.translate(event({ objectType: 'order', eventType: 'order.created' }));

    expect(result).toEqual({
      domain: 'order',
      externalId: '42',
      eventType: 'created',
      occurredAt: '2026-01-01T00:00:00.000Z',
      payload: {},
    });
  });

  it('should map order.status_changed to updated', () => {
    const result = translator.translate(
      event({ objectType: 'order', eventType: 'order.status_changed' })
    );

    expect(result?.domain).toBe('order');
    expect(result?.eventType).toBe('updated');
  });

  it('should default an unknown order event type to updated', () => {
    const result = translator.translate(event({ objectType: 'order', eventType: 'order.weird' }));

    expect(result?.eventType).toBe('updated');
  });

  it('should translate stock to the inventory domain', () => {
    const result = translator.translate(
      event({ objectType: 'stock', eventType: 'stock.changed', externalId: '7' })
    );

    expect(result?.domain).toBe('inventory');
    expect(result?.externalId).toBe('7');
  });

  it('should translate product to the product domain', () => {
    const result = translator.translate(
      event({ objectType: 'product', eventType: 'product.saved', externalId: '99' })
    );

    expect(result?.domain).toBe('product');
    expect(result?.externalId).toBe('99');
  });

  it('should be case-insensitive on objectType', () => {
    const result = translator.translate(event({ objectType: 'ORDER', eventType: 'order.created' }));

    expect(result?.domain).toBe('order');
  });

  it('should return null for an unknown object type (undecodable → dead-letter)', () => {
    expect(translator.translate(event({ objectType: 'category' }))).toBeNull();
  });
});

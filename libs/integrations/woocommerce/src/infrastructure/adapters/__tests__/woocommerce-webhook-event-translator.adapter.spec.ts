/**
 * WooCommerce Webhook Event Translator Adapter Unit Tests (#1548)
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/__tests__
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { WooCommerceWebhookEventTranslatorAdapter } from '../woocommerce-webhook-event-translator.adapter';

describe('WooCommerceWebhookEventTranslatorAdapter', () => {
  const translator = new WooCommerceWebhookEventTranslatorAdapter();

  const event = (overrides: Partial<InboundWebhookEvent>): InboundWebhookEvent => ({
    eventId: 'evt-1',
    provider: 'woocommerce',
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

  it('should map order.updated to updated', () => {
    const result = translator.translate(event({ objectType: 'order', eventType: 'order.updated' }));

    expect(result?.domain).toBe('order');
    expect(result?.eventType).toBe('updated');
  });

  it('should default a non-create order event (e.g. order.deleted) to updated', () => {
    // Only order.created / order.updated are provisioned, so anything that
    // isn't a create falls back to a safe re-pull (updated).
    const result = translator.translate(event({ objectType: 'order', eventType: 'order.deleted' }));

    expect(result?.eventType).toBe('updated');
  });

  it('should accept the bare action form (created) without the topic prefix', () => {
    const result = translator.translate(event({ objectType: 'order', eventType: 'created' }));

    expect(result?.eventType).toBe('created');
  });

  it('should default an unknown order event type to updated', () => {
    const result = translator.translate(event({ objectType: 'order', eventType: 'order.weird' }));

    expect(result?.eventType).toBe('updated');
  });

  it('should be case-insensitive on objectType', () => {
    const result = translator.translate(event({ objectType: 'ORDER', eventType: 'order.created' }));

    expect(result?.domain).toBe('order');
  });

  it('should preserve externalId and payload', () => {
    const result = translator.translate(
      event({ objectType: 'order', externalId: '777', payload: { id: 777, status: 'processing' } }),
    );

    expect(result?.externalId).toBe('777');
    expect(result?.payload).toEqual({ id: 777, status: 'processing' });
  });

  it('should return null for an unknown object type (undecodable -> dead-letter)', () => {
    expect(translator.translate(event({ objectType: 'product' }))).toBeNull();
    expect(translator.translate(event({ objectType: 'coupon' }))).toBeNull();
  });
});

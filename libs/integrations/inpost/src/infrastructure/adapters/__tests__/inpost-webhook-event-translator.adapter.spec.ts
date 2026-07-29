/**
 * InPost Webhook Event Translator Adapter Tests (#1510, ADR-015 / ADR-021)
 *
 * Asserts the translator maps the decoder's neutral `InboundWebhookEvent` (only
 * the `shipment` object type InPost emits) onto a neutral
 * `CanonicalInboundEvent` with `domain: 'shipment'`, and is TOTAL — a
 * non-shipment object type returns `null` (→ dead-letter) and never throws.
 *
 * Fixtures mirror the decoder spec (`inpost-inbound-webhook-decoder.adapter.spec.ts`):
 * the same `Shipment.Tracking` shape flows out of the decoder as an
 * `InboundWebhookEvent` and into this translator.
 *
 * @module libs/integrations/inpost/src/infrastructure/adapters/__tests__
 */
import type { InboundWebhookEvent } from '@openlinker/core/events';
import { InpostWebhookEventTranslatorAdapter } from '../inpost-webhook-event-translator.adapter';

/**
 * A `Shipment.Tracking` event as the decoder emits it. The decoder's OQ-B3
 * best-guess (sandbox-unconfirmed) extracts the parcel/shipment identifier from
 * `payload.shipment_id` (ranked first), falling back to `tracking_number`; the
 * fixture uses the decoder spec's `tracking_number` value so a future correction
 * to that extraction path is a one-line fixture change here.
 */
function makeShipmentEvent(overrides: Partial<InboundWebhookEvent> = {}): InboundWebhookEvent {
  return {
    eventId: 'inpost-fake-1',
    provider: 'inpost',
    connectionId: 'conn-inpost-fake',
    eventType: 'tracking',
    occurredAt: '2025-01-08T14:03:55.387Z',
    receivedAt: '2025-01-08T14:03:56.000Z',
    objectType: 'shipment',
    externalId: '6200000000001',
    payload: { tracking_number: '6200000000001' },
    ...overrides,
  };
}

describe('InpostWebhookEventTranslatorAdapter', () => {
  let translator: InpostWebhookEventTranslatorAdapter;

  beforeEach(() => {
    translator = new InpostWebhookEventTranslatorAdapter();
  });

  it('should map a Shipment.Tracking event to a neutral shipment CanonicalInboundEvent', () => {
    const result = translator.translate(makeShipmentEvent());

    expect(result).toEqual({
      domain: 'shipment',
      externalId: '6200000000001',
      eventType: 'tracking',
      occurredAt: '2025-01-08T14:03:55.387Z',
      payload: { tracking_number: '6200000000001' },
    });
  });

  it('should carry the decoder-extracted parcel id (OQ-B3 path) through as externalId', () => {
    // OQ-B3: the decoder's parcel-id-path is a sandbox-unconfirmed best-guess.
    // The translator does NOT re-derive the id — it passes the decoder's
    // `externalId` through verbatim, so this asserts the current assumption
    // (whatever the decoder extracts is what the shipment refresh re-reads).
    const result = translator.translate(
      makeShipmentEvent({ externalId: '49', payload: { shipment_id: 49 } }),
    );

    expect(result?.externalId).toBe('49');
  });

  it('should pass occurredAt and payload through unchanged', () => {
    const result = translator.translate(
      makeShipmentEvent({
        occurredAt: '2026-01-01T00:00:00.000Z',
        payload: { shipment_id: 49, status: 'confirmed' },
      }),
    );

    expect(result?.occurredAt).toBe('2026-01-01T00:00:00.000Z');
    expect(result?.payload).toEqual({ shipment_id: 49, status: 'confirmed' });
  });

  it('should preserve the advisory eventType from the decoder', () => {
    const result = translator.translate(makeShipmentEvent({ eventType: 'tracking' }));

    expect(result?.eventType).toBe('tracking');
  });

  it('should return null for a non-shipment object type without throwing', () => {
    const orderEvent = makeShipmentEvent({ objectType: 'order' });

    expect(() => translator.translate(orderEvent)).not.toThrow();
    expect(translator.translate(orderEvent)).toBeNull();
  });

  it('should return null for an unrelated object type (e.g. product)', () => {
    expect(translator.translate(makeShipmentEvent({ objectType: 'product' }))).toBeNull();
  });
});

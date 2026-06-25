/**
 * Unit tests for ErliInboundWebhookDecoderAdapter (#1081, ADR-021).
 *
 * All wire constants are provisional (#992); tests are deliberately written
 * against the named constants (`ERLI_WEBHOOK_ACCESS_TOKEN_HEADER`, etc.) so
 * that updating the constants in `erli-webhook.types.ts` cascades through
 * without touching these assertions.
 */
import { ErliInboundWebhookDecoderAdapter } from '../erli-inbound-webhook-decoder.adapter';

const SECRET = 'test-access-token-secret-ol-side';
const ORDER_ID = 'erli-order-fake-123';

function makeBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({ type: 'orderCreated', orderId: ORDER_ID, ...overrides }),
  );
}

describe('ErliInboundWebhookDecoderAdapter', () => {
  let decoder: ErliInboundWebhookDecoderAdapter;

  beforeEach(() => {
    decoder = new ErliInboundWebhookDecoderAdapter();
  });

  // ---------------------------------------------------------------------------
  // verify()
  // ---------------------------------------------------------------------------

  describe('verify', () => {
    it('should accept a correctly-matched access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { 'x-access-token': SECRET },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept the header in any casing', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { 'X-Access-Token': SECRET },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject a tampered (wrong) access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { 'x-access-token': 'wrong-token' },
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the access-token header is absent', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: {},
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should not return timestampMs (provisional: no signed timestamp from Erli)', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { 'x-access-token': SECRET },
        secret: SECRET,
      });
      expect(result).not.toHaveProperty('timestampMs');
    });
  });

  // ---------------------------------------------------------------------------
  // extractEnvelope()
  // ---------------------------------------------------------------------------

  describe('extractEnvelope', () => {
    it('should route an orderCreated event with the orderId as externalId', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.externalId).toBe(ORDER_ID);
      expect(result.envelope.eventType).toBe('orderCreated');
      expect(result.envelope.objectType).toBe('order');
    });

    it('should route an orderStatusChanged event', () => {
      const result = decoder.extractEnvelope(
        makeBody({ type: 'orderStatusChanged' }),
        {},
      );
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.eventType).toBe('orderStatusChanged');
    });

    it('should include a non-empty eventId', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(typeof result.envelope.eventId).toBe('string');
      expect(result.envelope.eventId.length).toBeGreaterThan(0);
    });

    it('should produce a deterministic eventId for the same orderId + eventType', () => {
      const a = decoder.extractEnvelope(makeBody(), {});
      const b = decoder.extractEnvelope(makeBody(), {});
      expect(a.action).toBe('route');
      expect(b.action).toBe('route');
      if (a.action !== 'route' || b.action !== 'route') return;
      expect(a.envelope.eventId).toBe(b.envelope.eventId);
    });

    it('should prefer an explicit eventId body field over the derived hash', () => {
      const explicitId = 'explicit-event-id-abc';
      const result = decoder.extractEnvelope(makeBody({ eventId: explicitId }), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.eventId).toBe(explicitId);
    });

    it('should produce distinct eventIds for the same orderId but different eventTypes', () => {
      const created = decoder.extractEnvelope(makeBody({ type: 'orderCreated' }), {});
      const changed = decoder.extractEnvelope(makeBody({ type: 'orderStatusChanged' }), {});
      expect(created.action).toBe('route');
      expect(changed.action).toBe('route');
      if (created.action !== 'route' || changed.action !== 'route') return;
      expect(created.envelope.eventId).not.toBe(changed.envelope.eventId);
    });

    it('should ignore (not reject) an unknown event type', () => {
      const result = decoder.extractEnvelope(makeBody({ type: 'unknownEvent' }), {});
      expect(result.action).toBe('ignore');
    });

    it('should reject malformed JSON', () => {
      const result = decoder.extractEnvelope(Buffer.from('not json'), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a missing orderId', () => {
      const body = Buffer.from(JSON.stringify({ type: 'orderCreated' }));
      const result = decoder.extractEnvelope(body, {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a blank orderId', () => {
      const result = decoder.extractEnvelope(makeBody({ orderId: '   ' }), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a non-string orderId', () => {
      const result = decoder.extractEnvelope(makeBody({ orderId: 42 }), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body missing the event type field', () => {
      const body = Buffer.from(JSON.stringify({ orderId: ORDER_ID }));
      const result = decoder.extractEnvelope(body, {});
      expect(result.action).toBe('reject');
    });

    it('should include the orderId in the envelope payload', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.payload).toMatchObject({ orderId: ORDER_ID });
    });

    it('should fall back to a non-empty occurredAt when the body has no timestamp', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(typeof result.envelope.occurredAt).toBe('string');
      expect(result.envelope.occurredAt.length).toBeGreaterThan(0);
    });

    it('should prefer occurredAt body field when present', () => {
      const ts = '2026-01-15T10:00:00.000Z';
      const result = decoder.extractEnvelope(makeBody({ occurredAt: ts }), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.occurredAt).toBe(ts);
    });
  });
});

/**
 * Unit tests for ErliInboundWebhookDecoderAdapter (#1081, ADR-021).
 *
 * Wire shapes are confirmed against the live sandbox (#992, 2026-07-01): the
 * body is the full order resource (no `type` discriminator), keyed by `id`;
 * the access token arrives on the standard `Authorization: Bearer <token>`
 * header. Tests are written against the named constants
 * (`ERLI_WEBHOOK_ACCESS_TOKEN_HEADER`, etc.) so future wire reconciliations
 * cascade through without touching these assertions.
 */
import { ErliInboundWebhookDecoderAdapter } from '../erli-inbound-webhook-decoder.adapter';

const SECRET = 'test-access-token-secret-ol-side';
const ORDER_ID = 'erli-order-fake-123';

function makeBody(overrides: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({ id: ORDER_ID, status: 'purchased', ...overrides }),
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
    it('should accept a correctly-matched Bearer access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { authorization: `Bearer ${SECRET}` },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept a bare (non-Bearer-prefixed) access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { authorization: SECRET },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept the header in any casing', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { Authorization: `Bearer ${SECRET}` },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should accept a lowercase "bearer" auth scheme', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { authorization: `bearer ${SECRET}` },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });

    it('should reject a tampered (wrong) access token', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { authorization: 'Bearer wrong-token' },
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the Authorization header is absent', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: {},
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should not return timestampMs (Erli sends no signed delivery timestamp)', () => {
      const result = decoder.verify({
        rawBody: makeBody(),
        headers: { authorization: `Bearer ${SECRET}` },
        secret: SECRET,
      });
      expect(result).not.toHaveProperty('timestampMs');
    });
  });

  // ---------------------------------------------------------------------------
  // extractEnvelope()
  // ---------------------------------------------------------------------------

  describe('extractEnvelope', () => {
    it('should route the full-order-resource body with id as externalId', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.externalId).toBe(ORDER_ID);
      expect(result.envelope.eventType).toBe('orderStatusChanged');
      expect(result.envelope.objectType).toBe('order');
    });

    it('should include a non-empty eventId', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(typeof result.envelope.eventId).toBe('string');
      expect(result.envelope.eventId.length).toBeGreaterThan(0);
    });

    it('should produce a deterministic eventId for the same orderId + updated timestamp', () => {
      const a = decoder.extractEnvelope(makeBody({ updated: '2026-07-01T11:20:17.415Z' }), {});
      const b = decoder.extractEnvelope(makeBody({ updated: '2026-07-01T11:20:17.415Z' }), {});
      expect(a.action).toBe('route');
      expect(b.action).toBe('route');
      if (a.action !== 'route' || b.action !== 'route') return;
      expect(a.envelope.eventId).toBe(b.envelope.eventId);
    });

    it('should produce a deterministic eventId across retried deliveries of a timestamp-less body', () => {
      // Guards against the eventId hash basis absorbing the decode-time "now"
      // fallback used for the envelope's advisory occurredAt — that value must
      // stay out of the dedup hash or every retry would mint a fresh eventId
      // and defeat the Postgres eventId-dedup gate.
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

    it('should produce distinct eventIds for successive deliveries of the same order (create, then cancel)', () => {
      const created = decoder.extractEnvelope(
        makeBody({ updated: '2026-07-01T11:20:17.415Z' }),
        {},
      );
      const cancelled = decoder.extractEnvelope(
        makeBody({ status: 'cancelled', updated: '2026-07-01T11:37:02.000Z' }),
        {},
      );
      expect(created.action).toBe('route');
      expect(cancelled.action).toBe('route');
      if (created.action !== 'route' || cancelled.action !== 'route') return;
      expect(created.envelope.eventId).not.toBe(cancelled.envelope.eventId);
    });

    it('should reject malformed JSON', () => {
      const result = decoder.extractEnvelope(Buffer.from('not json'), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a missing id', () => {
      const body = Buffer.from(JSON.stringify({ status: 'purchased' }));
      const result = decoder.extractEnvelope(body, {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a blank id', () => {
      const result = decoder.extractEnvelope(makeBody({ id: '   ' }), {});
      expect(result.action).toBe('reject');
    });

    it('should reject a body with a non-string id', () => {
      const result = decoder.extractEnvelope(makeBody({ id: 42 }), {});
      expect(result.action).toBe('reject');
    });

    it('should include the order id in the envelope payload', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.payload).toMatchObject({ id: ORDER_ID });
    });

    it('should fall back to a non-empty occurredAt when the body has no timestamp', () => {
      const result = decoder.extractEnvelope(makeBody(), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(typeof result.envelope.occurredAt).toBe('string');
      expect(result.envelope.occurredAt.length).toBeGreaterThan(0);
    });

    it('should prefer the updated body field for occurredAt when present', () => {
      const ts = '2026-01-15T10:00:00.000Z';
      const result = decoder.extractEnvelope(makeBody({ updated: ts }), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.occurredAt).toBe(ts);
    });
  });
});

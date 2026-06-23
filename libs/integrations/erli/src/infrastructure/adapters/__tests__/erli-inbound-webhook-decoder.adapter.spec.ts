/**
 * Erli Inbound Webhook Decoder Adapter Tests (#1145)
 *
 * Asserts the decode seam confirmed against the Erli Shop API docs (#992):
 * `verify` is a timing-safe compare of the `Authorization: Bearer {accessToken}`
 * token against the per-connection secret (no HMAC, no timestamp → no
 * `timestampMs`); `extractEnvelope` reads the `{ id, status }` body, routes order
 * events with a deterministic id+status `eventId`, ignores non-order bodies, and
 * rejects malformed ones. The Bearer secret is never logged.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters/__tests__
 */
import { ErliInboundWebhookDecoderAdapter } from '../erli-inbound-webhook-decoder.adapter';

const SECRET = 'super-secret-erli-webhook-token-DO-NOT-LOG';

function bodyBuf(value: unknown): Buffer {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}

describe('ErliInboundWebhookDecoderAdapter', () => {
  let adapter: ErliInboundWebhookDecoderAdapter;

  beforeEach(() => {
    adapter = new ErliInboundWebhookDecoderAdapter();
  });

  describe('verify', () => {
    it('should accept a matching Bearer token and return no timestampMs', () => {
      const result = adapter.verify({
        rawBody: bodyBuf({ id: 'o-1', status: 'pending' }),
        headers: { authorization: `Bearer ${SECRET}` },
        secret: SECRET,
      });

      expect(result).toEqual({ ok: true });
      expect(result.timestampMs).toBeUndefined();
    });

    it('should be case-insensitive on the header name and the Bearer scheme', () => {
      const result = adapter.verify({
        rawBody: bodyBuf({ id: 'o-1' }),
        headers: { Authorization: `bEaReR ${SECRET}` },
        secret: SECRET,
      });

      expect(result.ok).toBe(true);
    });

    it('should reject a wrong token', () => {
      expect(
        adapter.verify({
          rawBody: bodyBuf({ id: 'o-1' }),
          headers: { authorization: 'Bearer not-the-secret' },
          secret: SECRET,
        }),
      ).toEqual({ ok: false });
    });

    it('should reject a missing Authorization header', () => {
      expect(
        adapter.verify({ rawBody: bodyBuf({ id: 'o-1' }), headers: {}, secret: SECRET }),
      ).toEqual({ ok: false });
    });

    it('should reject a non-Bearer scheme', () => {
      expect(
        adapter.verify({
          rawBody: bodyBuf({ id: 'o-1' }),
          headers: { authorization: `Basic ${SECRET}` },
          secret: SECRET,
        }),
      ).toEqual({ ok: false });
    });

    it('should reject an empty Bearer token', () => {
      expect(
        adapter.verify({
          rawBody: bodyBuf({ id: 'o-1' }),
          headers: { authorization: 'Bearer    ' },
          secret: SECRET,
        }),
      ).toEqual({ ok: false });
    });

    it('should reject a token of a different length without throwing', () => {
      expect(
        adapter.verify({
          rawBody: bodyBuf({ id: 'o-1' }),
          headers: { authorization: 'Bearer short' },
          secret: SECRET,
        }),
      ).toEqual({ ok: false });
    });
  });

  describe('extractEnvelope', () => {
    it('should route an order body, surfacing id as externalId and orderStatusChanged eventType', () => {
      const result = adapter.extractEnvelope(bodyBuf({ id: 'order-42', status: 'purchased' }), {});

      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.externalId).toBe('order-42');
      expect(result.envelope.eventType).toBe('orderStatusChanged');
      expect(result.envelope.objectType).toBe('order');
      expect(result.envelope.eventId).toMatch(/^erli-[0-9a-f]{32}$/);
      expect(typeof result.envelope.occurredAt).toBe('string');
      // Only the advisory status hint is forwarded — never the raw body.
      expect(result.envelope.payload).toEqual({ status: 'purchased' });
    });

    it('should omit payload entirely when the body carries no status', () => {
      const result = adapter.extractEnvelope(bodyBuf({ id: 'order-7' }), {});
      expect(result.action).toBe('route');
      if (result.action !== 'route') return;
      expect(result.envelope.payload).toBeUndefined();
    });

    it('should derive a deterministic eventId from id + status', () => {
      const a = adapter.extractEnvelope(bodyBuf({ id: 'order-42', status: 'purchased' }), {});
      const b = adapter.extractEnvelope(bodyBuf({ id: 'order-42', status: 'purchased' }), {});
      expect(a.action).toBe('route');
      expect(b.action).toBe('route');
      if (a.action !== 'route' || b.action !== 'route') return;
      expect(a.envelope.eventId).toBe(b.envelope.eventId);
    });

    it('should distinguish different status transitions for the same order', () => {
      const shipped = adapter.extractEnvelope(bodyBuf({ id: 'order-42', status: 'shipped' }), {});
      const cancelled = adapter.extractEnvelope(
        bodyBuf({ id: 'order-42', status: 'cancelled' }),
        {},
      );
      if (shipped.action !== 'route' || cancelled.action !== 'route') {
        throw new Error('expected both to route');
      }
      expect(shipped.envelope.eventId).not.toBe(cancelled.envelope.eventId);
    });

    it('should ignore a well-formed body with no order id (e.g. productsNeedSync / ping)', () => {
      const result = adapter.extractEnvelope(
        bodyBuf({ externalProductIds: ['123'], fields: ['status'] }),
        {},
      );
      expect(result.action).toBe('ignore');
    });

    it('should reject a non-JSON body', () => {
      expect(adapter.extractEnvelope(bodyBuf('not json'), {}).action).toBe('reject');
    });

    it('should reject a non-object JSON body', () => {
      expect(adapter.extractEnvelope(bodyBuf('123'), {}).action).toBe('reject');
    });

    it('should ignore a body whose id is blank', () => {
      expect(adapter.extractEnvelope(bodyBuf({ id: '   ' }), {}).action).toBe('ignore');
    });
  });

  it('should NEVER log the secret across any channel', () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => undefined);

    adapter.verify({
      rawBody: bodyBuf({ id: 'o-1', status: 'pending' }),
      headers: { authorization: `Bearer ${SECRET}` },
      secret: SECRET,
    });
    adapter.extractEnvelope(bodyBuf({ id: 'o-1', status: 'pending' }), {});

    const allLogged = [logSpy, warnSpy, errorSpy, debugSpy]
      .flatMap((spy) => spy.mock.calls)
      .flatMap((call) => call.map((arg) => String(arg)))
      .join('\n');

    expect(allLogged).not.toContain(SECRET);

    jest.restoreAllMocks();
  });
});

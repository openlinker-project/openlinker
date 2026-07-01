/**
 * Infakt Inbound Webhook Decoder Adapter — unit tests
 *
 * @module libs/integrations/infakt/src/infrastructure/adapters/__tests__
 */
import { createHmac } from 'crypto';
import { InfaktInboundWebhookDecoderAdapter } from '../infakt-inbound-webhook-decoder.adapter';

const SECRET = 'test-webhook-secret';

function sign(body: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('InfaktInboundWebhookDecoderAdapter', () => {
  let adapter: InfaktInboundWebhookDecoderAdapter;

  beforeEach(() => {
    adapter = new InfaktInboundWebhookDecoderAdapter();
  });

  describe('detectHandshake', () => {
    it('should echo the verification_code when present', () => {
      const body = Buffer.from(JSON.stringify({ verification_code: 'abc123' }));
      expect(adapter.detectHandshake(body)).toEqual({ verification_code: 'abc123' });
    });

    it('should return null for a non-handshake payload', () => {
      const body = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      expect(adapter.detectHandshake(body)).toBeNull();
    });
  });

  describe('verify', () => {
    it('should return ok=true for a valid signature', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      const result = adapter.verify({
        rawBody,
        headers: { 'x-infakt-signature': sign(rawBody, SECRET) },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
      expect(result.timestampMs).toBeUndefined();
    });

    it('should return ok=false for an invalid signature', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      const result = adapter.verify({
        rawBody,
        headers: { 'x-infakt-signature': 'deadbeef' },
        secret: SECRET,
      });
      expect(result.ok).toBe(false);
    });

    it('should return ok=false when the signature header is missing', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      const result = adapter.verify({ rawBody, headers: {}, secret: SECRET });
      expect(result.ok).toBe(false);
    });

    it('should read the signature header case-insensitively', () => {
      const rawBody = Buffer.from(JSON.stringify({ event: { name: 'x' } }));
      const result = adapter.verify({
        rawBody,
        headers: { 'X-Infakt-Signature': sign(rawBody, SECRET) },
        secret: SECRET,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe('extractEnvelope', () => {
    it('should route a well-formed invoice event', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event: { uuid: 'e-1', name: 'send_to_ksef_success', retry_counter: 0, created_at: '2026-06-30T10:00:00Z' },
          resource: { status: 'success', invoice_uuid: 'inv-1', ksef_number: 'KSeF-1' },
        }),
      );
      const result = adapter.extractEnvelope(rawBody);
      expect(result).toEqual({
        action: 'route',
        envelope: {
          eventId: 'e-1',
          eventType: 'send_to_ksef_success',
          occurredAt: '2026-06-30T10:00:00Z',
          objectType: 'invoice',
          externalId: 'inv-1',
          payload: { status: 'success', invoice_uuid: 'inv-1', ksef_number: 'KSeF-1' },
        },
      });
    });

    it('should fall back to the event uuid as externalId when invoice_uuid is absent', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event: { uuid: 'e-2', name: 'draft_invoice_created', retry_counter: 0, created_at: '2026-06-30T10:00:00Z' },
          resource: { id: 42 },
        }),
      );
      const result = adapter.extractEnvelope(rawBody);
      expect(result.action).toBe('route');
      expect(result.action === 'route' && result.envelope.externalId).toBe('e-2');
    });

    it('should reject a malformed payload', () => {
      const rawBody = Buffer.from('not json');
      expect(adapter.extractEnvelope(rawBody)).toEqual({
        action: 'reject',
        reason: 'malformed Infakt webhook payload',
      });
    });
  });
});

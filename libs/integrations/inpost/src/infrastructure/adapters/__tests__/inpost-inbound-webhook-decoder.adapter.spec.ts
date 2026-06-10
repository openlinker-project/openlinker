/**
 * Unit tests for InpostInboundWebhookDecoderAdapter (#768, ADR-021).
 */
import { createHmac } from 'node:crypto';
import { InpostInboundWebhookDecoderAdapter } from '../inpost-inbound-webhook-decoder.adapter';

const SECRET = 'fdXbfU27DBNG6LuoHu@ThKl3';
const TIMESTAMP = '2025-01-08T14:03:55.387Z';

function sign(rawBody: Buffer, timestamp: string, secret: string): string {
  const signed = Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody]);
  return createHmac('sha256', secret).update(signed).digest('base64');
}

describe('InpostInboundWebhookDecoderAdapter', () => {
  let decoder: InpostInboundWebhookDecoderAdapter;

  beforeEach(() => {
    decoder = new InpostInboundWebhookDecoderAdapter();
  });

  describe('verify', () => {
    it('should accept a correctly-signed payload and return the normalized timestamp', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-inpost-signature': sign(rawBody, TIMESTAMP, SECRET),
          'x-inpost-timestamp': TIMESTAMP,
        },
      });
      expect(result.ok).toBe(true);
      expect(result.timestampMs).toBe(Date.parse(TIMESTAMP));
    });

    it('should reject a tampered signature', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-inpost-signature': sign(Buffer.from('different'), TIMESTAMP, SECRET),
          'x-inpost-timestamp': TIMESTAMP,
        },
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when signature or timestamp header is missing', () => {
      const rawBody = Buffer.from('{}');
      expect(decoder.verify({ rawBody, secret: SECRET, headers: {} }).ok).toBe(false);
    });
  });

  describe('extractEnvelope', () => {
    it('should route a Shipment.Tracking event with the parcel id as externalId', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.extractEnvelope(rawBody, {
        'x-inpost-topic': 'Shipment.Tracking',
        'x-inpost-timestamp': TIMESTAMP,
      });
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.externalId).toBe('6200000000001');
        expect(result.envelope.objectType).toBe('shipment');
        expect(result.envelope.eventId).toBeTruthy();
      }
    });

    it('should derive a deterministic eventId for the same parcel + timestamp', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const headers = { 'x-inpost-topic': 'Shipment.Tracking', 'x-inpost-timestamp': TIMESTAMP };
      const a = decoder.extractEnvelope(rawBody, headers);
      const b = decoder.extractEnvelope(rawBody, headers);
      if (a.action === 'route' && b.action === 'route') {
        expect(a.envelope.eventId).toBe(b.envelope.eventId);
      } else {
        throw new Error('expected both to route');
      }
    });

    it('should prefer an explicit event id when present', () => {
      const rawBody = Buffer.from(
        JSON.stringify({ id: 'evt_abc123', tracking_number: '6200000000001' }),
      );
      const result = decoder.extractEnvelope(rawBody, {
        'x-inpost-topic': 'Shipment.Tracking',
        'x-inpost-timestamp': TIMESTAMP,
      });
      if (result.action === 'route') {
        expect(result.envelope.eventId).toBe('evt_abc123');
      } else {
        throw new Error('expected route');
      }
    });

    it('should ignore (not reject) a non-tracking topic', () => {
      const result = decoder.extractEnvelope(Buffer.from('{}'), {
        'x-inpost-topic': 'Shipment.Something',
      });
      expect(result.action).toBe('ignore');
    });

    it('should reject malformed JSON', () => {
      const result = decoder.extractEnvelope(Buffer.from('not json'), {
        'x-inpost-topic': 'Shipment.Tracking',
      });
      expect(result.action).toBe('reject');
    });

    it('should reject a tracking event with no parcel identifier', () => {
      const result = decoder.extractEnvelope(Buffer.from(JSON.stringify({ foo: 'bar' })), {
        'x-inpost-topic': 'Shipment.Tracking',
      });
      expect(result.action).toBe('reject');
    });

    it('should reject a tracking event missing the timestamp header', () => {
      const result = decoder.extractEnvelope(
        Buffer.from(JSON.stringify({ tracking_number: '6200000000001' })),
        { 'x-inpost-topic': 'Shipment.Tracking' },
      );
      expect(result.action).toBe('reject');
    });
  });
});

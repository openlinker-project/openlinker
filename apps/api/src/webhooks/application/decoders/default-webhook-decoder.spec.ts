/**
 * Unit tests for DefaultWebhookDecoder (#768, ADR-021).
 *
 * Pins the OL-module default decoder's behaviour: OL-HMAC verify + the
 * WebhookRequestDto envelope validation that preserves the pre-ADR-021
 * controller contract (202 valid / 401 bad-sig / 400 malformed surfaces).
 */
import { createHmac } from 'node:crypto';
import { DefaultWebhookDecoder } from './default-webhook-decoder';

const SECRET = 'ol-shared-secret';
const TS = '1780000000000';

function olSign(rawBody: Buffer, timestamp: string, secret: string): string {
  const signed = Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody]);
  return `sha256=${createHmac('sha256', secret).update(signed).digest('hex')}`;
}

const validEnvelope = {
  schemaVersion: 1,
  eventId: 'evt-123',
  eventType: 'order.created',
  occurredAt: '2026-06-08T10:00:00.000Z',
  object: { type: 'order', externalId: 'ps-42' },
  payload: { hint: true },
};

describe('DefaultWebhookDecoder', () => {
  let decoder: DefaultWebhookDecoder;

  beforeEach(() => {
    decoder = new DefaultWebhookDecoder();
  });

  describe('verify', () => {
    it('accepts a correctly OL-signed payload and returns the numeric timestamp', () => {
      const rawBody = Buffer.from(JSON.stringify(validEnvelope));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-openlinker-timestamp': TS,
          'x-openlinker-signature': olSign(rawBody, TS, SECRET),
        },
      });
      expect(result.ok).toBe(true);
      expect(result.timestampMs).toBe(Number(TS));
    });

    it('rejects a tampered signature', () => {
      const rawBody = Buffer.from(JSON.stringify(validEnvelope));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-openlinker-timestamp': TS,
          'x-openlinker-signature': olSign(Buffer.from('other'), TS, SECRET),
        },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects a non-sha256= signature format', () => {
      const rawBody = Buffer.from('{}');
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: { 'x-openlinker-timestamp': TS, 'x-openlinker-signature': 'deadbeef' },
      });
      expect(result.ok).toBe(false);
    });

    it('rejects when headers are missing', () => {
      expect(decoder.verify({ rawBody: Buffer.from('{}'), secret: SECRET, headers: {} }).ok).toBe(
        false,
      );
    });
  });

  describe('extractEnvelope', () => {
    it('routes a valid OL envelope into the neutral shape', () => {
      const result = decoder.extractEnvelope(Buffer.from(JSON.stringify(validEnvelope)), {});
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope).toEqual({
          eventId: 'evt-123',
          eventType: 'order.created',
          occurredAt: '2026-06-08T10:00:00.000Z',
          objectType: 'order',
          externalId: 'ps-42',
          payload: { hint: true },
        });
      }
    });

    it('rejects malformed JSON', () => {
      expect(decoder.extractEnvelope(Buffer.from('not json'), {}).action).toBe('reject');
    });

    it('rejects an envelope failing DTO validation (missing object)', () => {
      const bad = { schemaVersion: 1, eventId: 'e', eventType: 'order.created', occurredAt: '2026-06-08T10:00:00.000Z' };
      expect(decoder.extractEnvelope(Buffer.from(JSON.stringify(bad)), {}).action).toBe('reject');
    });

    it('rejects an envelope with a malformed eventType', () => {
      const bad = { ...validEnvelope, eventType: 'NOT VALID FORMAT' };
      expect(decoder.extractEnvelope(Buffer.from(JSON.stringify(bad)), {}).action).toBe('reject');
    });
  });
});

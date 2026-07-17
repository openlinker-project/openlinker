/**
 * Unit tests for InpostInboundWebhookDecoderAdapter (#768, ADR-021).
 */
import { createHmac } from 'node:crypto';
import { InpostInboundWebhookDecoderAdapter } from '../inpost-inbound-webhook-decoder.adapter';

const SECRET = 'fdXbfU27DBNG6LuoHu@ThKl3';
const TIMESTAMP = '2025-01-08T14:03:55.387Z';

/**
 * InPost's Example 2 — the signed content is `{x-inpost-timestamp}.{body}`.
 * Base64 per the docs' Java sample (`Base64.getEncoder().encodeToString(...)`).
 */
function signTimestampAndBody(rawBody: Buffer, timestamp: string, secret: string): string {
  const signed = Buffer.concat([Buffer.from(timestamp), Buffer.from('.'), rawBody]);
  return createHmac('sha256', secret).update(signed).digest('base64');
}

/**
 * InPost's Example 1 — the signed content is the raw body alone. Which of the
 * two variants a client receives is "configurable per client" (#1556), so the
 * decoder must authenticate both.
 */
function signBodyOnly(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
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
          'x-inpost-signature': signTimestampAndBody(rawBody, TIMESTAMP, SECRET),
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
          'x-inpost-signature': signTimestampAndBody(Buffer.from('different'), TIMESTAMP, SECRET),
          'x-inpost-timestamp': TIMESTAMP,
        },
      });
      expect(result.ok).toBe(false);
    });

    it('should reject when the signature header is missing', () => {
      const rawBody = Buffer.from('{}');
      expect(decoder.verify({ rawBody, secret: SECRET, headers: {} }).ok).toBe(false);
    });

    // #1556: the signed content is "configurable per client" — InPost's Example 1
    // (body only) is as valid as Example 2, and OL is not told which is in use.
    it('should accept a body-only signature when the timestamp header is present', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-inpost-signature': signBodyOnly(rawBody, SECRET),
          'x-inpost-timestamp': TIMESTAMP,
        },
      });
      expect(result.ok).toBe(true);
      expect(result.timestampMs).toBe(Date.parse(TIMESTAMP));
    });

    it('should accept a body-only signature when no timestamp header is sent', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: { 'x-inpost-signature': signBodyOnly(rawBody, SECRET) },
      });
      expect(result.ok).toBe(true);
      // No signed timestamp to replay-check — the host skips its replay window
      // when the field is absent, leaving the durable dedup gate as backstop.
      expect(result.timestampMs).toBeUndefined();
    });

    it('should reject a signature made with the wrong secret under either variant', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const headers = { 'x-inpost-timestamp': TIMESTAMP };
      expect(
        decoder.verify({
          rawBody,
          secret: SECRET,
          headers: { ...headers, 'x-inpost-signature': signBodyOnly(rawBody, 'wrong-secret') },
        }).ok,
      ).toBe(false);
      expect(
        decoder.verify({
          rawBody,
          secret: SECRET,
          headers: {
            ...headers,
            'x-inpost-signature': signTimestampAndBody(rawBody, TIMESTAMP, 'wrong-secret'),
          },
        }).ok,
      ).toBe(false);
    });

    it('should reject a timestamp-and-body signature replayed under a different timestamp', () => {
      const rawBody = Buffer.from(JSON.stringify({ tracking_number: '6200000000001' }));
      const result = decoder.verify({
        rawBody,
        secret: SECRET,
        headers: {
          'x-inpost-signature': signTimestampAndBody(rawBody, TIMESTAMP, SECRET),
          'x-inpost-timestamp': '2025-01-08T15:03:55.387Z',
        },
      });
      expect(result.ok).toBe(false);
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

  // Regression suite pinned to the authoritative ShipX webhook payload shape
  // (docs page "[1.23.0] Webhooks"): `{ event_ts, event, organization_id,
  // payload: { shipment_id, status, tracking_number } }`. These lock in that the
  // decoder extracts the ShipX `shipment_id` (the refresh key for
  // `GET /v1/shipments/{id}`) — NOT the nested/nullable `tracking_number` — and
  // classifies the event from the body when no `x-inpost-topic` header is sent.
  describe('extractEnvelope — real ShipX payload shape', () => {
    // A `shipment_status_changed` event; `tracking_number` is null early in the
    // lifecycle, so the refresh cannot rely on it — `shipment_id` is the key.
    function realStatusWebhook(overrides: Record<string, unknown> = {}): Buffer {
      return Buffer.from(
        JSON.stringify({
          event_ts: '2020-03-20 15:08:42 +0100',
          event: 'shipment_status_changed',
          organization_id: 1,
          payload: { shipment_id: 49, status: 'confirmed', tracking_number: null },
          ...overrides,
        }),
      );
    }

    it('should route a body-classified status event and extract payload.shipment_id', () => {
      const result = decoder.extractEnvelope(realStatusWebhook(), {});
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        // The refresh (`GET /v1/shipments/{id}`) consumes this verbatim.
        expect(result.envelope.externalId).toBe('49');
        expect(result.envelope.objectType).toBe('shipment');
        expect(result.envelope.eventType).toBe('tracking');
        // Falls back to the body `event_ts` when no header timestamp is present,
        // normalized from ShipX's non-ISO form to the envelope's ISO-8601
        // contract, preserving the instant and offset (#1556).
        expect(result.envelope.occurredAt).toBe('2020-03-20T15:08:42+01:00');
        expect(Date.parse(result.envelope.occurredAt)).toBe(
          Date.parse('2020-03-20 15:08:42 +0100'),
        );
      }
    });

    it('should normalize a fractional-second event_ts and pass an ISO value through untouched', () => {
      const fractional = decoder.extractEnvelope(
        realStatusWebhook({ event_ts: '2020-03-20 15:08:42.123 +0100' }),
        {},
      );
      expect(fractional.action).toBe('route');
      if (fractional.action === 'route') {
        expect(fractional.envelope.occurredAt).toBe('2020-03-20T15:08:42.123+01:00');
      }

      // Already-ISO payloads (InPost's newer shape) must not be rewritten.
      const iso = decoder.extractEnvelope(
        realStatusWebhook({ event_ts: '2025-01-08T14:02:55.374675Z' }),
        {},
      );
      expect(iso.action).toBe('route');
      if (iso.action === 'route') {
        expect(iso.envelope.occurredAt).toBe('2025-01-08T14:02:55.374675Z');
      }
    });

    it('should prefer the x-inpost-event-id header as the dedup key', () => {
      const result = decoder.extractEnvelope(realStatusWebhook({ event_id: 'body-event-id' }), {
        'x-inpost-event-id': 'header-event-id',
      });
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        // InPost's own "Unique id of the event" outranks body fields and the hash.
        expect(result.envelope.eventId).toBe('header-event-id');
      }
    });

    it('should route a shipment_confirmed event', () => {
      const result = decoder.extractEnvelope(realStatusWebhook({ event: 'shipment_confirmed' }), {});
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.externalId).toBe('49');
      }
    });

    it('should ignore a non-tracking body event (offers_prepared)', () => {
      const result = decoder.extractEnvelope(realStatusWebhook({ event: 'offers_prepared' }), {});
      expect(result.action).toBe('ignore');
    });

    it('should prefer the header timestamp over the body event_ts when both are present', () => {
      // Both a signed header timestamp and a body `event_ts` are present; the
      // signed header must win (it is the value the host replay-window checks).
      const result = decoder.extractEnvelope(realStatusWebhook(), {
        'x-inpost-timestamp': TIMESTAMP,
      });
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.occurredAt).toBe(TIMESTAMP);
        expect(result.envelope.externalId).toBe('49');
      }
    });

    it('should decode a combined header + body payload', () => {
      // Header carries the topic + signed timestamp; body carries the ShipX
      // event + nested shipment_id. Both halves must be honoured together.
      const result = decoder.extractEnvelope(realStatusWebhook(), {
        'x-inpost-topic': 'Shipment.Tracking',
        'x-inpost-timestamp': TIMESTAMP,
      });
      expect(result.action).toBe('route');
      if (result.action === 'route') {
        expect(result.envelope.externalId).toBe('49');
        expect(result.envelope.objectType).toBe('shipment');
        expect(result.envelope.eventType).toBe('tracking');
        expect(result.envelope.occurredAt).toBe(TIMESTAMP);
        expect(result.envelope.eventId).toBeTruthy();
      }
    });

    it('should prefer payload.shipment_id over a present tracking_number', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event_ts: '2020-03-20 15:08:42 +0100',
          event: 'shipment_status_changed',
          payload: { shipment_id: 49, tracking_number: '6200000000001' },
        }),
      );
      const result = decoder.extractEnvelope(rawBody, {});
      if (result.action === 'route') {
        expect(result.envelope.externalId).toBe('49');
      } else {
        throw new Error('expected route');
      }
    });

    it('should reject a status event with no shipment identifier', () => {
      const rawBody = Buffer.from(
        JSON.stringify({
          event_ts: '2020-03-20 15:08:42 +0100',
          event: 'shipment_status_changed',
          payload: { status: 'confirmed' },
        }),
      );
      expect(decoder.extractEnvelope(rawBody, {}).action).toBe('reject');
    });
  });
});

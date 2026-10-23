import type { DecodeResult } from '@openlinker/core/integrations';

import { ShoperInboundWebhookDecoderAdapter } from '../shoper-inbound-webhook-decoder.adapter';

const SECRET = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const decoder = new ShoperInboundWebhookDecoderAdapter();

function body(record: Record<string, unknown>): Buffer {
  return Buffer.from(JSON.stringify(record));
}

function route(result: DecodeResult): Extract<DecodeResult, { action: 'route' }> {
  if (result.action !== 'route') {
    throw new Error(`expected a route, got ${result.action}`);
  }
  return result;
}

describe('ShoperInboundWebhookDecoderAdapter', () => {
  describe('verify', () => {
    const verify = (query?: Record<string, string>, secret = SECRET) =>
      decoder.verify({ rawBody: body({}), headers: {}, secret, ...(query === undefined ? {} : { query }) });

    it('should accept the delivery whose URL token is the connection secret', () => {
      expect(verify({ token: SECRET })).toEqual({ ok: true });
    });

    it('should not report a timestamp, since Shoper signs none and the replay check must not fire', () => {
      expect(verify({ token: SECRET })).not.toHaveProperty('timestampMs');
    });

    it.each([
      ['no query at all', undefined],
      ['an empty query', {}],
      ['an empty token', { token: '' }],
      ['a wrong token', { token: 'a1b2c3d4e5f60718293a4b5c6d7e8f91' }],
      ['a token of another length', { token: 'short' }],
      ['a prefix of the secret', { token: SECRET.slice(0, -1) }],
      ['the secret with extra characters', { token: `${SECRET}x` }],
      ['the token under another key', { secret: SECRET }],
    ])('should refuse %s', (_name, query) => {
      expect(verify(query as Record<string, string> | undefined)).toEqual({ ok: false });
    });

    it('should refuse when the stored secret is empty, never matching an empty token', () => {
      expect(verify({ token: '' }, '')).toEqual({ ok: false });
      expect(verify({ token: 'anything' }, '')).toEqual({ ok: false });
    });
  });

  describe('extractEnvelope', () => {
    const order = { order_id: '8', status_id: '1', sum: '100.00', status_date: '2026-09-29 13:37:23' };

    it('should route an order delivery on the order id only, never carrying the order body', () => {
      const { envelope } = route(
        decoder.extractEnvelope(body(order), { 'x-webhook-name': 'order.status' }),
      );

      expect(envelope).toMatchObject({
        eventType: 'order.status',
        objectType: 'order',
        externalId: '8',
        payload: { id: '8' },
      });
      expect(JSON.stringify(envelope)).not.toContain('100.00');
    });

    it('should accept a numeric order id', () => {
      const { envelope } = route(decoder.extractEnvelope(body({ order_id: 42 }), {}));

      expect(envelope.externalId).toBe('42');
    });

    it('should treat a delivery that names no event as an update, i.e. a safe re-read', () => {
      expect(route(decoder.extractEnvelope(body(order), {})).envelope.eventType).toBe('order.edit');
    });

    it('should read the event header case-insensitively', () => {
      const { envelope } = route(decoder.extractEnvelope(body(order), { 'X-Webhook-Name': 'order.paid' } as never));

      expect(envelope.eventType).toBe('order.paid');
    });

    it('should ignore an authentic delivery of another resource, so it is a 202 and not a retry storm', () => {
      const result = decoder.extractEnvelope(body({ user_id: '3' }), { 'x-webhook-name': 'client.create' });

      expect(result).toMatchObject({ action: 'ignore' });
    });

    it.each([
      ['no order id', { sum: '1' }],
      ['an order id of zero', { order_id: '0' }],
      ['a non-numeric order id', { order_id: 'abc' }],
      ['a negative order id', { order_id: '-4' }],
    ])('should ignore a body with %s', (_name, record) => {
      expect(decoder.extractEnvelope(body(record), { 'x-webhook-name': 'order.create' })).toMatchObject({
        action: 'ignore',
      });
    });

    it.each([['not json'], ['']])('should reject a body that is not JSON: %p', (raw) => {
      expect(decoder.extractEnvelope(Buffer.from(raw), {})).toMatchObject({ action: 'reject' });
    });

    it.each([['[]'], ['"text"'], ['null'], ['5']])('should reject a JSON body that is not an object: %s', (raw) => {
      expect(decoder.extractEnvelope(Buffer.from(raw), {})).toMatchObject({ action: 'reject' });
    });
  });

  describe('event id (the dedup key)', () => {
    const idOf = (record: Record<string, unknown>, name = 'order.status'): string =>
      route(decoder.extractEnvelope(body(record), { 'x-webhook-name': name })).envelope.eventId;

    it('should be identical for a retried delivery of the same body, so the dedup gate catches it', () => {
      const order = { order_id: '8', status_id: '1', status_date: '2026-09-29 13:37:23' };

      expect(idOf(order)).toBe(idOf({ ...order }));
    });

    it('should differ when the order really changed', () => {
      expect(idOf({ order_id: '8', status_id: '1' })).not.toBe(idOf({ order_id: '8', status_id: '2' }));
    });

    it('should differ for the same body under a different event', () => {
      const order = { order_id: '8', status_id: '1' };

      expect(idOf(order, 'order.status')).not.toBe(idOf(order, 'order.paid'));
    });

    it('should not depend on the clock, which would mint a new id on every retry', () => {
      const first = idOf({ order_id: '8' });
      jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00Z'));
      try {
        expect(idOf({ order_id: '8' })).toBe(first);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

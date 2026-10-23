import { createHash } from 'node:crypto';

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
    const WEBHOOK_ID = '7';
    const RAW = body({ product_id: 23, stock: { stock: '4.0000' }, name: 'Kubek' });

    // Shoper's scheme, written out independently of the adapter so a change to
    // it cannot make both sides agree on a wrong formula.
    const sign = (rawBody: Buffer, secret = SECRET, webhookId = WEBHOOK_ID): string =>
      createHash('sha1').update(`${webhookId}:${secret}:${rawBody.toString('utf8')}`).digest('hex');

    const signedHeaders = (overrides: Record<string, string> = {}): Record<string, string> => ({
      'x-webhook-name': 'product.edit',
      'x-webhook-id': WEBHOOK_ID,
      'x-webhook-sha1': sign(RAW),
      ...overrides,
    });

    // `query: null` stands for a delivery URL with no query string at all.
    const verify = ({
      query = { token: SECRET },
      headers = signedHeaders(),
      rawBody = RAW,
      secret = SECRET,
    }: {
      query?: Record<string, string> | null;
      headers?: Record<string, string>;
      rawBody?: Buffer;
      secret?: string;
    } = {}) => decoder.verify({ rawBody, headers, secret, ...(query === null ? {} : { query }) });

    it('should accept a delivery whose URL token and signature both match the connection secret', () => {
      expect(verify()).toEqual({ ok: true });
    });

    it('should accept the signature in upper-case hex', () => {
      expect(verify({ headers: signedHeaders({ 'x-webhook-sha1': sign(RAW).toUpperCase() }) })).toEqual({
        ok: true,
      });
    });

    it('should read the signature headers case-insensitively', () => {
      const headers = { 'X-Webhook-Id': WEBHOOK_ID, 'X-Webhook-Sha1': sign(RAW) };

      expect(verify({ headers })).toEqual({ ok: true });
    });

    it('should sign the RAW bytes, so a re-serialised body with the same content is refused', () => {
      const reformatted = Buffer.from(JSON.stringify(JSON.parse(RAW.toString('utf8')), null, 2));

      expect(verify({ rawBody: reformatted })).toEqual({ ok: false });
    });

    it('should not report a timestamp, since Shoper signs none and the replay check must not fire', () => {
      expect(verify()).not.toHaveProperty('timestampMs');
    });

    describe('the signature', () => {
      it.each([
        ['a forged signature', { 'x-webhook-sha1': 'f'.repeat(40) }],
        ['a signature of another length', { 'x-webhook-sha1': 'abc' }],
        ['an empty signature', { 'x-webhook-sha1': '' }],
        ['a signature over another webhook id', { 'x-webhook-sha1': sign(RAW, SECRET, '8') }],
        ['a signature made with another secret', { 'x-webhook-sha1': sign(RAW, 'another-secret') }],
        ['the right signature under another webhook id', { 'x-webhook-id': '8' }],
      ])('should refuse %s, even though the URL token is right', (_name, overrides) => {
        expect(verify({ headers: signedHeaders(overrides) })).toEqual({ ok: false });
      });

      it('should refuse a delivery with no signature header, even though the URL token is right', () => {
        const { 'x-webhook-sha1': _dropped, ...headers } = signedHeaders();

        expect(verify({ headers })).toEqual({ ok: false });
      });

      it('should refuse a delivery with no webhook id header, even though the URL token is right', () => {
        const { 'x-webhook-id': _dropped, ...headers } = signedHeaders();

        expect(verify({ headers })).toEqual({ ok: false });
      });

      it('should refuse a body changed after signing', () => {
        expect(verify({ rawBody: body({ product_id: 24 }) })).toEqual({ ok: false });
      });
    });

    describe('the URL token', () => {
      it.each([
        ['no query at all', null],
        ['an empty query', {}],
        ['an empty token', { token: '' }],
        ['a wrong token', { token: 'a1b2c3d4e5f60718293a4b5c6d7e8f91' }],
        ['a token of another length', { token: 'short' }],
        ['a prefix of the secret', { token: SECRET.slice(0, -1) }],
        ['the secret with extra characters', { token: `${SECRET}x` }],
        ['the token under another key', { secret: SECRET }],
      ])('should refuse %s, even though the signature is right', (_name, query) => {
        expect(verify({ query: query as Record<string, string> | null })).toEqual({ ok: false });
      });
    });

    it('should refuse when the stored secret is empty, never matching an empty token', () => {
      expect(verify({ query: { token: '' }, secret: '' })).toEqual({ ok: false });
      expect(verify({ query: { token: 'anything' }, secret: '' })).toEqual({ ok: false });
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

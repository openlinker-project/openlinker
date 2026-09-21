import { SubiektOrderSourceAdapter } from '../subiekt-order-source.adapter';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import type { LoggerPort } from '@openlinker/shared/logging';

const noopLogger: LoggerPort = {
  log: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function fakeFetch(bodyByPath: Record<string, unknown>): typeof fetch {
  return ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    for (const [path, body] of Object.entries(bodyByPath)) {
      if (url.includes(path)) {
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, data: body, error: null }), {
            status: 200,
          }),
        );
      }
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({ success: false, data: null, error: { code: 'not_found', reason: 'no fixture' } }),
        { status: 404 },
      ),
    );
  }) as unknown as typeof fetch;
}

describe('SubiektOrderSourceAdapter', () => {
  it('maps a feed page to OrderFeedOutput with a date-watermark cursor', async () => {
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', {
      fetchImpl: fakeFetch({
        '/api/orders/feed': {
          items: [{ id: 42, numer: 'ZK 1/2026', dataWystawienia: '2026-09-01T10:00:00Z' }],
          nextCursor: '2026-09-01T10:00:00Z',
        },
      }),
    });
    const adapter = new SubiektOrderSourceAdapter(client, noopLogger);

    const result = await adapter.listOrderFeed({ fromCursor: null, limit: 50 });

    expect(result.items).toEqual([
      {
        externalOrderId: '42',
        eventType: 'updated',
        occurredAt: '2026-09-01T10:00:00Z',
        eventKey: '42:2026-09-01T10:00:00Z',
      },
    ]);
    expect(result.nextCursor).toBe('2026-09-01T10:00:00Z');
  });

  it('hydrates a full order via getOrder', async () => {
    const client = new SubiektOrdersBridgeClient('http://127.0.0.1:5056', {
      fetchImpl: fakeFetch({
        '/api/orders/42': {
          id: 42,
          numer: 'ZK 1/2026',
          dataWystawienia: '2026-09-01T10:00:00Z',
          kontrahentNazwa: 'Jan Kowalski',
          kontrahentNip: null,
          kontrahentEmail: 'jan@example.com',
          waluta: 'PLN',
          wartoscBrutto: 123.45,
          lines: [{ symbol: 'SKU-1', nazwa: 'Widget', ilosc: 3, wartoscBrutto: 123.45 }],
        },
      }),
    });
    const adapter = new SubiektOrderSourceAdapter(client, noopLogger);

    const order = await adapter.getOrder({ externalOrderId: '42' });

    expect(order.externalOrderId).toBe('42');
    expect(order.orderNumber).toBe('ZK 1/2026');
    expect(order.customerEmail).toBe('jan@example.com');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ sku: 'SKU-1', quantity: 3, price: 41.15 });
    expect(order.totals.total).toBe(123.45);
    expect(order.totals.currency).toBe('PLN');
  });
});

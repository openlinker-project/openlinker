import { SubiektOrderSourceAdapter } from '../subiekt-order-source.adapter';
import { SubiektOrdersBridgeClient } from '../../../bridge/subiekt-orders-bridge.client';
import {
  OrderSyncStartUnavailableError,
  isOrderFeedBootstrap,
  isOrderFeedDateBootstrap,
  isOrderWindowReader,
} from '@openlinker/core/orders';
import type { LoggerPort } from '@openlinker/shared/logging';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

const CONNECTION_ID = 'conn-1';

/** No mappings at all: every line falls through to a product reference. */
function emptyMappings(): InMemoryIdentifierMappingAdapter {
  return new InMemoryIdentifierMappingAdapter();
}

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
    const adapter = new SubiektOrderSourceAdapter(client, noopLogger, emptyMappings(), CONNECTION_ID);

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
    const adapter = new SubiektOrderSourceAdapter(client, noopLogger, emptyMappings(), CONNECTION_ID);

    const order = await adapter.getOrder({ externalOrderId: '42' });

    expect(order.externalOrderId).toBe('42');
    expect(order.orderNumber).toBe('ZK 1/2026');
    expect(order.customerEmail).toBe('jan@example.com');
    expect(order.items).toHaveLength(1);
    expect(order.items[0]).toMatchObject({ sku: 'SKU-1', quantity: 3, price: 41.15 });
    // #3359: `line.symbol` is exactly the towar symbol ProductMaster maps
    // as `CORE_ENTITY_TYPE.Product` - `type: 'sku'` (a DISTINCT mapping
    // kind nothing in this adapter's ProductMaster sync ever creates) made
    // every native order-line resolution fail 100% of the time.
    expect(order.items[0].productRef).toEqual({ type: 'product', externalId: 'SKU-1' });
    expect(order.totals.total).toBe(123.45);
    expect(order.totals.currency).toBe('PLN');
  });

  // #3365. A towar the operator grouped into a MODEL has no `Product` mapping
  // under its own symbol and never will - a model is ONE OpenLinker product
  // keyed `model:{mdt_Id}`, and its members are mapped as VARIANTS. Before
  // this, every such line resolved to nothing and the order sat
  // `awaiting_mapping` forever, silently, because an unmapped line is a
  // normal self-healing state elsewhere.
  describe('a towar inside a model resolves through its VARIANT mapping (#3365)', () => {
    function orderClient(symbol: string): SubiektOrdersBridgeClient {
      return new SubiektOrdersBridgeClient('http://127.0.0.1:5056', {
        fetchImpl: fakeFetch({
          '/api/orders/42': {
            id: 42,
            numer: 'ZK 1/2026',
            dataWystawienia: '2026-09-01T10:00:00Z',
            kontrahentNazwa: 'Jan Kowalski',
            kontrahentEmail: 'jan@example.com',
            waluta: 'PLN',
            wartoscBrutto: 100,
            lines: [{ symbol, nazwa: 'Widget', ilosc: 1, wartoscBrutto: 100 }],
          },
        }),
      });
    }

    async function refFor(
      symbol: string,
      mappings: InMemoryIdentifierMappingAdapter,
    ): Promise<unknown> {
      const adapter = new SubiektOrderSourceAdapter(
        orderClient(symbol),
        noopLogger,
        mappings,
        CONNECTION_ID,
      );
      const order = await adapter.getOrder({ externalOrderId: '42' });
      return order.items[0].productRef;
    }

    it('names the canonical variant key when one is mapped', async () => {
      const mappings = emptyMappings();
      mappings.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100::variant',
        connectionId: CONNECTION_ID,
        internalId: 'ol_variant_1',
      });

      await expect(refFor('WOBLACK100', mappings)).resolves.toEqual({
        type: 'variant',
        externalId: 'WOBLACK100::variant',
      });
    });

    // An install that predates the canonical key still carries bare symbols on
    // its variant mappings. Checking legacy first is what makes this safe to
    // deploy rather than a one-time repeat of the bug it fixes.
    it('names the LEGACY bare key when that is what the install carries', async () => {
      const mappings = emptyMappings();
      mappings.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100',
        connectionId: CONNECTION_ID,
        internalId: 'ol_variant_legacy',
      });

      await expect(refFor('WOBLACK100', mappings)).resolves.toEqual({
        type: 'variant',
        externalId: 'WOBLACK100',
      });
    });

    it('leaves a standalone towar resolving as a product, exactly as before', async () => {
      await expect(refFor('SKU-1', emptyMappings())).resolves.toEqual({
        type: 'product',
        externalId: 'SKU-1',
      });
    });

    // Another connection's variant mapping must not answer for this one.
    it('ignores a variant mapped on a DIFFERENT connection', async () => {
      const mappings = emptyMappings();
      mappings.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: 'WOBLACK100::variant',
        connectionId: 'some-other-connection',
        internalId: 'ol_variant_elsewhere',
      });

      await expect(refFor('WOBLACK100', mappings)).resolves.toEqual({
        type: 'product',
        externalId: 'WOBLACK100',
      });
    });

    // It must LOOK UP, never mint: a mint here would create a variant id for a
    // towar OpenLinker has never synced and point a real order line at a
    // product that does not exist.
    it('mints nothing for a towar it has never seen', async () => {
      const mappings = emptyMappings();

      await refFor('NEVER-SYNCED', mappings);

      await expect(
        mappings.getInternalId(CORE_ENTITY_TYPE.ProductVariant, 'NEVER-SYNCED::variant', CONNECTION_ID),
      ).resolves.toBeNull();
      await expect(
        mappings.getInternalId(CORE_ENTITY_TYPE.ProductVariant, 'NEVER-SYNCED', CONNECTION_ID),
      ).resolves.toBeNull();
    });
  });

  describe('feed bootstrap', () => {
    const envelope = (data: unknown): Response =>
      new Response(JSON.stringify({ success: true, data, error: null }), { status: 200 });
    const make = (
      handler: (url: string) => Response,
      logger: LoggerPort = noopLogger,
    ): SubiektOrderSourceAdapter =>
      new SubiektOrderSourceAdapter(
        new SubiektOrdersBridgeClient('http://127.0.0.1:5056', {
          fetchImpl: ((input: RequestInfo | URL) =>
            Promise.resolve(handler(String(input)))) as unknown as typeof fetch,
        }),
        logger,
        emptyMappings(),
        CONNECTION_ID,
      );

    it('returns the head cursor from the bridge', async () => {
      const adapter = make(() => envelope({ nextCursor: '2026-09-01T00:00:00.0000000|7' }));
      await expect(adapter.headCursor()).resolves.toBe('2026-09-01T00:00:00.0000000|7');
    });

    it('returns null when the bridge has no orders', async () => {
      const adapter = make(() => envelope({ nextCursor: null }));
      await expect(adapter.headCursor()).resolves.toBeNull();
    });

    it('falls back to walking the feed on a 404 and warns', async () => {
      const warn = jest.fn();
      const feedCalls: string[] = [];
      const adapter = make(
        (url) => {
          if (url.includes('/api/orders/feed/head')) return new Response('', { status: 404 });
          feedCalls.push(url);
          if (feedCalls.length === 1) {
            return envelope({
              items: [{ id: 1, numer: 'ZK 1', dataWystawienia: '2026-01-01T00:00:00Z' }],
              nextCursor: 'c1',
            });
          }
          if (feedCalls.length === 2) {
            return envelope({
              items: [{ id: 2, numer: 'ZK 2', dataWystawienia: '2026-01-02T00:00:00Z' }],
              nextCursor: 'c2',
            });
          }
          return envelope({ items: [], nextCursor: null });
        },
        { ...noopLogger, warn },
      );
      await expect(adapter.headCursor()).resolves.toBe('c2');
      expect(feedCalls[0]).toContain('limit=1000');
      expect(feedCalls[1]).toContain('since=c1');
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('fallback returns null when the first page is empty', async () => {
      const adapter = make((url) =>
        url.includes('/head') ? new Response('', { status: 404 }) : envelope({ items: [], nextCursor: null }),
      );
      await expect(adapter.headCursor()).resolves.toBeNull();
    });

    it('throws on a 500 from the head route', async () => {
      const adapter = make(
        () =>
          new Response(
            JSON.stringify({ success: false, data: null, error: { code: 'sfera_error', reason: 'boom' } }),
            { status: 500 },
          ),
      );
      await expect(adapter.headCursor()).rejects.toThrow();
    });

    it('formats a date cursor', async () => {
      const adapter = make(() => envelope({}));
      await expect(adapter.cursorForDate('2026-03-05')).resolves.toBe('2026-03-05T00:00:00.0000000|0');
    });

    it('takes the day prefix of an ISO instant', async () => {
      const adapter = make(() => envelope({}));
      await expect(adapter.cursorForDate('2026-03-05T14:30:00.000Z')).resolves.toBe(
        '2026-03-05T00:00:00.0000000|0',
      );
    });

    it('rejects an instant whose day prefix is not a real date', async () => {
      const adapter = make(() => envelope({}));
      await expect(adapter.cursorForDate('2026-02-30T10:00:00Z')).rejects.toThrow(
        OrderSyncStartUnavailableError,
      );
    });

    it('stops the fallback walk at the page cap and tells the operator to upgrade', async () => {
      let feedCalls = 0;
      const adapter = make((url) => {
        if (url.includes('/api/orders/feed/head')) return new Response('', { status: 404 });
        feedCalls += 1;
        return envelope({
          items: [{ id: feedCalls, numer: `ZK ${feedCalls}`, dataWystawienia: '2026-01-01T00:00:00Z' }],
          nextCursor: `c${feedCalls}`,
        });
      });
      const failure = adapter.headCursor();
      await expect(failure).rejects.toThrow(OrderSyncStartUnavailableError);
      await expect(failure).rejects.toThrow(/Upgrade the Subiekt bridge/);
      expect(feedCalls).toBe(50);
    });

    it('should stop the fallback walk when the wall-clock budget is spent', async () => {
      let feedCalls = 0;
      let clock = 0;
      const adapter = new SubiektOrderSourceAdapter(
        new SubiektOrdersBridgeClient('http://127.0.0.1:5056', {
          fetchImpl: ((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/api/orders/feed/head')) return Promise.resolve(new Response('', { status: 404 }));
            feedCalls += 1;
            clock += 70_000;
            return Promise.resolve(
              envelope({
                items: [{ id: feedCalls, numer: `ZK ${feedCalls}`, dataWystawienia: '2026-01-01T00:00:00Z' }],
                nextCursor: `c${feedCalls}`,
              }),
            );
          }) as unknown as typeof fetch,
        }),
        noopLogger,
        emptyMappings(),
        CONNECTION_ID,
        () => clock,
      );
      await expect(adapter.headCursor()).rejects.toThrow(/Upgrade the Subiekt bridge/);
      expect(feedCalls).toBe(3);
    });

    it('fallback returns the previous cursor when a non-empty page carries no next cursor', async () => {
      let calls = 0;
      const adapter = make((url) => {
        if (url.includes('/head')) return new Response('', { status: 404 });
        calls += 1;
        return calls === 1
          ? envelope({
              items: [{ id: 1, numer: 'ZK 1', dataWystawienia: '2026-01-01T00:00:00Z' }],
              nextCursor: 'c1',
            })
          : envelope({
              items: [{ id: 2, numer: 'ZK 2', dataWystawienia: '2026-01-02T00:00:00Z' }],
              nextCursor: null,
            });
      });
      await expect(adapter.headCursor()).resolves.toBe('c1');
    });

    it('declares the bootstrap capabilities and no window reader', () => {
      const adapter = make(() => envelope({}));
      expect(isOrderFeedBootstrap(adapter)).toBe(true);
      expect(isOrderFeedDateBootstrap(adapter)).toBe(true);
      expect(isOrderWindowReader(adapter)).toBe(false);
    });

    it.each(['2026-3-5', 'yesterday', '2026-02-30', ''])('rejects invalid date %p', async (d) => {
      const adapter = make(() => envelope({}));
      await expect(adapter.cursorForDate(d)).rejects.toThrow(OrderSyncStartUnavailableError);
    });
  });
});

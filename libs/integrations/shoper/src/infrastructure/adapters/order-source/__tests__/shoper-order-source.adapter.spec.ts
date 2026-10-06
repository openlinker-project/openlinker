import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import { orderMarker } from '../../../mappers/shoper-order-input.mapper';
import type { ShoperOrderReferenceProvider } from '../../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { ShoperOrderSourceAdapter } from '../shoper-order-source.adapter';
import { LINES, WARSAW, buildLineRow, buildOrderRow } from './shoper-order-source-test-data';

function envelope<T>(list: readonly T[], pages = 1, page = 1): { status: number; data: unknown } {
  return { status: 200, data: { count: String(list.length), pages, page, list } };
}

function setup(): {
  adapter: ShoperOrderSourceAdapter;
  get: jest.Mock;
  reference: jest.Mocked<Pick<ShoperOrderReferenceProvider, 'getStatus' | 'getCurrencyCode' | 'getShippingName'>>;
} {
  const get = jest.fn();
  const reference = {
    getStatus: jest.fn().mockResolvedValue({ type: 3, labels: ['przesyłka wysłana'] }),
    getCurrencyCode: jest.fn().mockResolvedValue('PLN'),
    getShippingName: jest.fn().mockResolvedValue('Odbiór osobisty'),
  };
  const shopContext = { get: jest.fn().mockResolvedValue({ timezone: WARSAW }) };
  const adapter = new ShoperOrderSourceAdapter(
    { get } as unknown as ShoperHttpClient,
    reference as unknown as ShoperOrderReferenceProvider,
    shopContext as unknown as ShoperShopContextProvider,
    { id: 'conn-1' } as Connection,
  );
  return { adapter, get, reference };
}

describe('ShoperOrderSourceAdapter', () => {
  describe('listOrderFeed', () => {
    it('should read the oldest orders first when there is no cursor, ordered by id ascending', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '1' }), buildOrderRow({ order_id: '2' })]));

      const feed = await adapter.listOrderFeed({ fromCursor: null, limit: 20 });

      expect(get).toHaveBeenCalledWith('/orders', { order: 'order_id ASC', limit: 20, page: 1 });
      expect(feed.items.map((i) => i.externalOrderId)).toEqual(['1', '2']);
      expect(feed.nextCursor).toBe('2');
    });

    it('should resume past the cursor with a keyset filter, never an offset', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '7' })]));

      await adapter.listOrderFeed({ fromCursor: '6', limit: 20 });

      expect(get).toHaveBeenCalledWith('/orders', {
        order: 'order_id ASC',
        'filters[order_id][>]': '6',
        limit: 20,
        page: 1,
      });
    });

    it("should cap the page at Shoper's ceiling instead of letting it silently fall back to 10", async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([]));

      await adapter.listOrderFeed({ fromCursor: null, limit: 500 });

      expect(get).toHaveBeenCalledWith('/orders', expect.objectContaining({ limit: 50 }));
    });

    it('should hold the cursor on an empty page', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([]));

      await expect(adapter.listOrderFeed({ fromCursor: '16', limit: 20 })).resolves.toEqual({
        items: [],
        nextCursor: '16',
      });
      await expect(adapter.listOrderFeed({ fromCursor: null, limit: 20 })).resolves.toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('should take the highest id as the cursor even when the page is not in order', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(
        envelope([buildOrderRow({ order_id: '9' }), buildOrderRow({ order_id: '16' }), buildOrderRow({ order_id: '8' })]),
      );

      await expect(adapter.listOrderFeed({ fromCursor: '7', limit: 20 })).resolves.toMatchObject({
        nextCursor: '16',
      });
    });

    it('should report each order once as created, with a stable key and the shop-local time in UTC', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '2', date: '2026-09-27 13:12:16' })]));

      const { items } = await adapter.listOrderFeed({ fromCursor: null, limit: 20 });

      expect(items).toEqual([
        {
          externalOrderId: '2',
          eventType: 'created',
          occurredAt: '2026-09-27T11:12:16.000Z',
          eventKey: '2:created',
        },
      ]);
    });

    it.each([
      ['cancelled', { type: 4, labels: ['anulowane'] }],
      ['rejected', { type: 4, labels: ['odrzucone'] }],
      ['returned', { type: 4, labels: ['zwrócone'] }],
    ])('should report a %s order as cancelled even on first sight, so core never mirrors it', async (_name, status) => {
      const { adapter, get, reference } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '8', status_id: '8' })]));
      reference.getStatus.mockResolvedValue(status);

      const { items } = await adapter.listOrderFeed({ fromCursor: null, limit: 20 });

      expect(items).toEqual([expect.objectContaining({ externalOrderId: '8', eventType: 'cancelled', eventKey: '8:cancelled' })]);
    });

    it('should filter by the event type each order actually produces', async () => {
      const { adapter, get, reference } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '7' }), buildOrderRow({ order_id: '8', status_id: '8' })]));
      reference.getStatus.mockImplementation((id: string) =>
        Promise.resolve(id === '8' ? { type: 4, labels: ['anulowane'] } : { type: 1, labels: ['złożone'] }),
      );

      const created = await adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['created'] });
      const cancelled = await adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['cancelled'] });

      expect(created.items.map((i) => i.externalOrderId)).toEqual(['7']);
      expect(cancelled.items.map((i) => i.externalOrderId)).toEqual(['8']);
      expect(created.nextCursor).toBe('8');
    });

    it('should drop an order OpenLinker created itself but advance the cursor over it', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(
        envelope([
          buildOrderRow({ order_id: '10', notes_priv: orderMarker('ol_order_abc') }),
          buildOrderRow({ order_id: '11', notes_priv: 'call the buyer first' }),
          buildOrderRow({ order_id: '12', notes_priv: null }),
        ]),
      );

      const feed = await adapter.listOrderFeed({ fromCursor: '9', limit: 20 });

      expect(feed.items.map((i) => i.externalOrderId)).toEqual(['11', '12']);
      expect(feed.nextCursor).toBe('12');
    });

    it('should not freeze the cursor on a page made only of its own orders', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '10', notes_priv: orderMarker('ol_order_a') })]));

      await expect(adapter.listOrderFeed({ fromCursor: '9', limit: 20 })).resolves.toEqual({
        items: [],
        nextCursor: '10',
      });
    });

    it('should return no items, but still advance, when the caller asks only for event types the page does not produce', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '5' })]));

      await expect(
        adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['updated', 'paid'] }),
      ).resolves.toEqual({ items: [], nextCursor: '5' });
    });

    it.each([['abc'], ['1.5'], ['-3'], ['']])('should refuse the non-numeric cursor %p', async (cursor) => {
      const { adapter, get } = setup();

      await expect(adapter.listOrderFeed({ fromCursor: cursor, limit: 20 })).rejects.toBeInstanceOf(RangeError);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getOrder', () => {
    function shopWith(get: jest.Mock, lines: readonly unknown[] = LINES): void {
      get.mockImplementation((path: string) => {
        if (path === '/orders/2') {
          return Promise.resolve({ status: 200, data: buildOrderRow() });
        }
        if (path === '/order-products') {
          return Promise.resolve(envelope(lines));
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
    }

    it('should read the order and its lines and map them to an IncomingOrder', async () => {
      const { adapter, get, reference } = setup();
      shopWith(get);

      const order = await adapter.getOrder({ externalOrderId: '2' });

      expect(get).toHaveBeenCalledWith('/orders/2');
      expect(get).toHaveBeenCalledWith('/order-products', {
        'filters[order_id]': '2',
        order: 'id ASC',
        limit: 50,
        page: 1,
      });
      expect(reference.getStatus).toHaveBeenCalledWith('7');
      expect(reference.getCurrencyCode).toHaveBeenCalledWith('1');
      expect(reference.getShippingName).toHaveBeenCalledWith('8');
      expect(order).toMatchObject({
        externalOrderId: '2',
        status: 'shipped',
        paymentStatus: 'paid',
        totals: { total: 133.84, currency: 'PLN', taxTreatment: 'inclusive' },
        placedAt: '2026-09-27T11:12:16.000Z',
      });
      expect(order.items).toHaveLength(2);
    });

    it('should read every page of lines', async () => {
      const { adapter, get } = setup();
      const second = buildLineRow({ id: '11', stock_id: '300' });
      get.mockImplementation((path: string, query?: Record<string, unknown>) => {
        if (path === '/orders/2') {
          return Promise.resolve({ status: 200, data: buildOrderRow() });
        }
        return Promise.resolve(
          query?.page === 1 ? envelope([buildLineRow()], 2, 1) : envelope([second], 2, 2),
        );
      });

      const order = await adapter.getOrder({ externalOrderId: '2' });

      expect(order.items.map((i) => i.id)).toEqual(['9', '11']);
    });

    it('should refuse a non-numeric id before any request is made', async () => {
      const { adapter, get } = setup();

      await expect(adapter.getOrder({ externalOrderId: '../products' })).rejects.toBeInstanceOf(RangeError);
      expect(get).not.toHaveBeenCalled();
    });

    it("should let Shoper's own not-found answer through unchanged", async () => {
      const { adapter, get } = setup();
      const notFound = new ShoperApiError(404, 'invalid_request', 'Resource not found');
      get.mockRejectedValue(notFound);

      await expect(adapter.getOrder({ externalOrderId: '99999' })).rejects.toBe(notFound);
    });

    it('should refuse an answer that names a different order', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue({ status: 200, data: buildOrderRow({ order_id: '3' }) });

      await expect(adapter.getOrder({ externalOrderId: '2' })).rejects.toBeInstanceOf(ShoperNetworkError);
    });

    it('should refuse lines of another order, since that means the filter was not honoured', async () => {
      const { adapter, get } = setup();
      shopWith(get, [buildLineRow(), buildLineRow({ id: '40', order_id: '5' })]);

      await expect(adapter.getOrder({ externalOrderId: '2' })).rejects.toBeInstanceOf(ShoperNetworkError);
    });

    it('should read an unlisted status as pending and say so', async () => {
      const { adapter, get, reference } = setup();
      shopWith(get);
      reference.getStatus.mockResolvedValue(null);
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const order = await adapter.getOrder({ externalOrderId: '2' });

      expect(order.status).toBe('pending');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('status 7'));
      warn.mockRestore();
    });

    it('should not read the status, currency or shipping tables for an order that names none', async () => {
      const { adapter, get, reference } = setup();
      get.mockImplementation((path: string) =>
        path === '/orders/2'
          ? Promise.resolve({
              status: 200,
              data: buildOrderRow({ status_id: null, currency_id: null, shipping_id: null }),
            })
          : Promise.resolve(envelope(LINES)),
      );

      const order = await adapter.getOrder({ externalOrderId: '2' });

      expect(reference.getStatus).not.toHaveBeenCalled();
      expect(reference.getCurrencyCode).not.toHaveBeenCalled();
      expect(reference.getShippingName).not.toHaveBeenCalled();
      expect(order).not.toHaveProperty('shipping');
    });
  });
});

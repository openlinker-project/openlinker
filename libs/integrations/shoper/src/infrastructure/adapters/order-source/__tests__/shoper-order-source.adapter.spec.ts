import type { Connection } from '@openlinker/core/identifier-mapping';
import { Logger } from '@openlinker/shared/logging';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import type { ShoperOrderRow } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import { formatShoperFeedCursor } from '../../../mappers/shoper-order-feed-cursor.mapper';
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
  put: jest.Mock;
  reference: jest.Mocked<
    Pick<ShoperOrderReferenceProvider, 'getStatus' | 'getCurrencyCode' | 'getShippingName' | 'listStatuses'>
  >;
} {
  const get = jest.fn();
  const put = jest.fn().mockResolvedValue({ status: 200, data: 1 });
  const reference = {
    getStatus: jest.fn().mockResolvedValue({ type: 3, labels: ['przesyłka wysłana'] }),
    getCurrencyCode: jest.fn().mockResolvedValue('PLN'),
    getShippingName: jest.fn().mockResolvedValue('Odbiór osobisty'),
    listStatuses: jest.fn().mockResolvedValue([]),
  };
  const shopContext = { get: jest.fn().mockResolvedValue({ timezone: WARSAW }) };
  const adapter = new ShoperOrderSourceAdapter(
    { get, put } as unknown as ShoperHttpClient,
    reference as unknown as ShoperOrderReferenceProvider,
    shopContext as unknown as ShoperShopContextProvider,
    { id: 'conn-1' } as Connection,
  );
  return { adapter, get, put, reference };
}

describe('ShoperOrderSourceAdapter', () => {
  describe('listOrderFeed', () => {
    /** The shop answering the three `/orders` reads the feed makes, told apart by their sort. */
    function feedShop(
      get: jest.Mock,
      shop: {
        orders?: readonly ShoperOrderRow[];
        statusChanges?: readonly (readonly ShoperOrderRow[])[];
        latest?: readonly ShoperOrderRow[];
      },
    ): void {
      get.mockImplementation((path: string, query: Record<string, string | number>) => {
        if (path !== '/orders') return Promise.reject(new Error(`unexpected GET ${path}`));
        if (query.order === 'order_id ASC') return Promise.resolve(envelope(shop.orders ?? []));
        if (query.order === 'status_date DESC') return Promise.resolve(envelope(shop.latest ?? []));
        const pages = shop.statusChanges ?? [[]];
        const page = Number(query.page);
        return Promise.resolve(envelope(pages[page - 1] ?? [], pages.length, page));
      });
    }

    const cursor = (lastOrderId: string | null, watermark: string | null = null): string =>
      formatShoperFeedCursor({
        lastOrderId,
        statusWatermark: watermark,
        statusPassStart: null,
        statusNextPage: null,
      });

    describe('new orders (order_id keyset)', () => {
      it('should read the oldest orders first when there is no cursor, ordered by id ascending', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '1' }), buildOrderRow({ order_id: '2' })] });

        const feed = await adapter.listOrderFeed({ fromCursor: null, limit: 20 });

        expect(get).toHaveBeenCalledWith('/orders', { order: 'order_id ASC', limit: 20, page: 1 });
        expect(feed.items.map((i) => i.externalOrderId)).toEqual(['1', '2']);
        expect(feed.nextCursor).toBe(cursor('2'));
      });

      it('should resume past the cursor with a keyset filter, never an offset', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '7' })] });

        await adapter.listOrderFeed({ fromCursor: cursor('6'), limit: 20 });

        expect(get).toHaveBeenCalledWith('/orders', {
          order: 'order_id ASC',
          'filters[order_id][>]': '6',
          limit: 20,
          page: 1,
        });
      });

      it('should keep reading a cursor written before the status pass existed (a bare order id)', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '17' })] });

        const feed = await adapter.listOrderFeed({ fromCursor: '16', limit: 20 });

        expect(get).toHaveBeenCalledWith('/orders', expect.objectContaining({ 'filters[order_id][>]': '16' }));
        expect(feed.nextCursor).toBe(cursor('17'));
      });

      it("should cap the page at Shoper's ceiling instead of letting it silently fall back to 10", async () => {
        const { adapter, get } = setup();
        feedShop(get, {});

        await adapter.listOrderFeed({ fromCursor: null, limit: 500 });

        expect(get).toHaveBeenCalledWith('/orders', expect.objectContaining({ order: 'order_id ASC', limit: 50 }));
      });

      it('should hold the order id on an empty page', async () => {
        const { adapter, get } = setup();
        feedShop(get, {});

        await expect(adapter.listOrderFeed({ fromCursor: cursor('16'), limit: 20 })).resolves.toEqual({
          items: [],
          nextCursor: cursor('16'),
        });
        await expect(adapter.listOrderFeed({ fromCursor: null, limit: 20 })).resolves.toEqual({
          items: [],
          nextCursor: cursor(null),
        });
      });

      it('should take the highest id as the cursor even when the page is not in order', async () => {
        const { adapter, get } = setup();
        feedShop(get, {
          orders: [buildOrderRow({ order_id: '9' }), buildOrderRow({ order_id: '16' }), buildOrderRow({ order_id: '8' })],
        });

        await expect(adapter.listOrderFeed({ fromCursor: cursor('7'), limit: 20 })).resolves.toMatchObject({
          nextCursor: cursor('16'),
        });
      });

      it('should report each order once as created, with a stable key and the shop-local time in UTC', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '2', date: '2026-09-27 13:12:16' })] });

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
        feedShop(get, { orders: [buildOrderRow({ order_id: '8', status_id: '8' })] });
        reference.getStatus.mockResolvedValue(status);

        const { items } = await adapter.listOrderFeed({ fromCursor: null, limit: 20 });

        expect(items).toEqual([
          expect.objectContaining({ externalOrderId: '8', eventType: 'cancelled', eventKey: '8:cancelled' }),
        ]);
      });

      it('should filter by the event type each order actually produces', async () => {
        const { adapter, get, reference } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '7' }), buildOrderRow({ order_id: '8', status_id: '8' })] });
        reference.getStatus.mockImplementation((id: string) =>
          Promise.resolve(id === '8' ? { type: 4, labels: ['anulowane'] } : { type: 1, labels: ['złożone'] }),
        );

        const created = await adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['created'] });
        const cancelled = await adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['cancelled'] });

        expect(created.items.map((i) => i.externalOrderId)).toEqual(['7']);
        expect(cancelled.items.map((i) => i.externalOrderId)).toEqual(['8']);
        expect(created.nextCursor).toBe(cursor('8'));
      });

      it('should drop an order OpenLinker created itself but advance the cursor over it', async () => {
        const { adapter, get } = setup();
        feedShop(get, {
          orders: [
            buildOrderRow({ order_id: '10', notes_priv: orderMarker('ol_order_abc') }),
            buildOrderRow({ order_id: '11', notes_priv: 'call the buyer first' }),
            buildOrderRow({ order_id: '12', notes_priv: null }),
          ],
        });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('9'), limit: 20 });

        expect(feed.items.map((i) => i.externalOrderId)).toEqual(['11', '12']);
        expect(feed.nextCursor).toBe(cursor('12'));
      });

      it('should not freeze the cursor on a page made only of its own orders', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '10', notes_priv: orderMarker('ol_order_a') })] });

        await expect(adapter.listOrderFeed({ fromCursor: cursor('9'), limit: 20 })).resolves.toEqual({
          items: [],
          nextCursor: cursor('10'),
        });
      });

      it('should return no items, but still advance, when the caller asks only for event types the page does not produce', async () => {
        const { adapter, get } = setup();
        feedShop(get, { orders: [buildOrderRow({ order_id: '5' })] });

        await expect(
          adapter.listOrderFeed({ fromCursor: null, limit: 20, eventTypes: ['updated', 'paid'] }),
        ).resolves.toEqual({ items: [], nextCursor: cursor('5') });
      });

      it.each([['abc'], ['1.5'], ['-3'], [''], ['v2|abc|||'], ['v3|1|||']])(
        'should refuse the unreadable cursor %p',
        async (value) => {
          const { adapter, get } = setup();

          await expect(adapter.listOrderFeed({ fromCursor: value, limit: 20 })).rejects.toBeInstanceOf(RangeError);
          expect(get).not.toHaveBeenCalled();
        },
      );
    });

    describe('status changes (status_date watermark)', () => {
      const WATERMARK = '2026-10-20 12:00:00';

      it('should stamp the watermark from the shop on the first poll and report nothing older', async () => {
        const { adapter, get } = setup();
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        feedShop(get, { latest: [buildOrderRow({ order_id: '40', status_date: '2026-10-21 09:30:00' })] });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39'), limit: 20 });

        expect(get).toHaveBeenCalledWith('/orders', { order: 'status_date DESC', limit: 1, page: 1 });
        expect(get).not.toHaveBeenCalledWith('/orders', expect.objectContaining({ order: 'status_date ASC' }));
        expect(feed).toEqual({ items: [], nextCursor: cursor('39', '2026-10-21 09:30:00') });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('stamping it at 2026-10-21 09:30:00'));
        warn.mockRestore();
      });

      it('should read changes since the watermark less the lookback, in status_date order', async () => {
        const { adapter, get } = setup();
        feedShop(get, {});

        await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });

        expect(get).toHaveBeenCalledWith('/orders', {
          order: 'status_date ASC',
          filters: JSON.stringify({ status_date: { '>=': '2026-10-20 11:55:00' } }),
          limit: 50,
          page: 1,
        });
      });

      it('should report a status change of an order already read as updated, keyed on the status and its date', async () => {
        const { adapter, get, reference } = setup();
        reference.getStatus.mockResolvedValue({ type: 2, labels: ['w realizacji'] });
        feedShop(get, {
          statusChanges: [
            [buildOrderRow({ order_id: '12', status_id: '3', date: '2026-10-01 10:00:00', status_date: '2026-10-20 12:05:00' })],
          ],
        });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });

        expect(feed.items).toEqual([
          {
            externalOrderId: '12',
            eventType: 'updated',
            occurredAt: '2026-10-20T10:05:00.000Z',
            eventKey: '12:updated:3@2026-10-20 12:05:00',
          },
        ]);
        expect(feed.nextCursor).toBe(cursor('39', '2026-10-20 12:05:00'));
      });

      it('should report a change to a terminal status as cancelled', async () => {
        const { adapter, get, reference } = setup();
        reference.getStatus.mockResolvedValue({ type: 4, labels: ['anulowane'] });
        feedShop(get, {
          statusChanges: [[buildOrderRow({ order_id: '12', status_id: '10', status_date: '2026-10-20 12:05:00' })]],
        });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });

        expect(feed.items).toEqual([
          expect.objectContaining({ eventType: 'cancelled', eventKey: '12:cancelled:10@2026-10-20 12:05:00' }),
        ]);
      });

      it('should leave to the new-orders pass an order it has not read yet, or just read in this poll', async () => {
        const { adapter, get } = setup();
        feedShop(get, {
          orders: [buildOrderRow({ order_id: '40', status_date: '2026-10-20 12:06:00' })],
          statusChanges: [
            [
              buildOrderRow({ order_id: '40', status_date: '2026-10-20 12:06:00' }),
              buildOrderRow({ order_id: '41', status_date: '2026-10-20 12:07:00' }),
            ],
          ],
        });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 1 });

        expect(feed.items.map((i) => i.eventKey)).toEqual(['40:created']);
        // The watermark still moves past them: the new-orders pass reads their current state.
        expect(feed.nextCursor).toBe(cursor('40', '2026-10-20 12:07:00'));
      });

      it('should skip an order still in the status it was placed in, and one OpenLinker created', async () => {
        const { adapter, get } = setup();
        feedShop(get, {
          statusChanges: [
            [
              buildOrderRow({ order_id: '12', date: '2026-10-20 12:01:00', status_date: '2026-10-20 12:01:00' }),
              buildOrderRow({ order_id: '13', status_date: '2026-10-20 12:02:00', notes_priv: orderMarker('ol_x') }),
            ],
          ],
        });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });

        expect(feed.items).toEqual([]);
        expect(feed.nextCursor).toBe(cursor('39', '2026-10-20 12:02:00'));
      });

      it('should never move the watermark back when the lookback re-reads older rows', async () => {
        const { adapter, get } = setup();
        feedShop(get, { statusChanges: [[buildOrderRow({ order_id: '12', status_date: '2026-10-20 11:58:00' })]] });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });

        expect(feed.nextCursor).toBe(cursor('39', WATERMARK));
      });

      it('should carry an unfinished pass to the next poll with the same lower bound, and finish it there', async () => {
        const { adapter, get } = setup();
        const pageOf = (id: string, at: string): ShoperOrderRow[] => [buildOrderRow({ order_id: id, status_date: at })];
        feedShop(get, {
          statusChanges: [
            pageOf('11', '2026-10-20 12:01:00'),
            pageOf('12', '2026-10-20 12:02:00'),
            pageOf('13', '2026-10-20 12:03:00'),
          ],
        });

        // limit 20 -> one status page per poll.
        const first = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 20 });
        expect(first.nextCursor).toBe('v2|39|2026-10-20 12:01:00|2026-10-20 11:55:00|2');

        get.mockClear();
        const second = await adapter.listOrderFeed({ fromCursor: first.nextCursor, limit: 100 });
        expect(get).toHaveBeenCalledWith(
          '/orders',
          expect.objectContaining({
            filters: JSON.stringify({ status_date: { '>=': '2026-10-20 11:55:00' } }),
            page: 2,
          }),
        );
        expect(second.items.map((i) => i.externalOrderId)).toEqual(['12', '13']);
        expect(second.nextCursor).toBe(cursor('39', '2026-10-20 12:03:00'));
      });

      it('should report one event per key when offset paging repeats a row', async () => {
        const { adapter, get } = setup();
        const row = buildOrderRow({ order_id: '12', status_date: '2026-10-20 12:01:00' });
        feedShop(get, { statusChanges: [[row], [row]] });

        const feed = await adapter.listOrderFeed({ fromCursor: cursor('39', WATERMARK), limit: 100 });

        expect(feed.items).toHaveLength(1);
      });
    });
  });

  describe('SourceOptionsReader', () => {
    it('should list the shop\'s shipping methods and payment methods by their own ids', async () => {
      const { adapter, get } = setup();
      get.mockImplementation((path: string) =>
        Promise.resolve(
          path === '/shippings'
            ? envelope([{ shipping_id: '8', translations: { pl_PL: { name: 'Odbiór osobisty' } } }])
            : envelope([{ payment_id: '1', translations: { pl_PL: { title: 'Przelew' } } }]),
        ),
      );

      await expect(adapter.listDeliveryMethods()).resolves.toEqual([{ value: '8', label: 'Odbiór osobisty' }]);
      await expect(adapter.listPaymentMethods()).resolves.toEqual([{ value: '1', label: 'Przelew' }]);
      expect(get).toHaveBeenCalledWith('/shippings', expect.objectContaining({ order: 'shipping_id ASC' }));
    });

    it('should list the neutral statuses orders arrive in, named after the shop statuses behind each', async () => {
      const { adapter, reference } = setup();
      reference.listStatuses.mockResolvedValue([
        { statusId: '1', type: 1, labels: ['złożone'] },
        { statusId: '2', type: 2, labels: ['w realizacji'] },
        { statusId: '3', type: 2, labels: ['oczekuje na dostawę'] },
        { statusId: '6', type: 4, labels: ['zwrócone'] },
        { statusId: '10', type: 4, labels: ['anulowane'] },
      ]);

      await expect(adapter.listOrderStatuses()).resolves.toEqual([
        { value: 'pending', label: 'Pending (Shoper: złożone)' },
        { value: 'processing', label: 'Processing (Shoper: w realizacji, oczekuje na dostawę)' },
        { value: 'refunded', label: 'Refunded (Shoper: zwrócone)' },
        { value: 'cancelled', label: 'Cancelled (Shoper: anulowane)' },
      ]);
    });
  });

  describe('write (OrderStatusWriteback)', () => {
    it('should write a cancellation to the source shop through the shared status writer', async () => {
      const { adapter, get, put, reference } = setup();
      get.mockResolvedValue({ status: 200, data: { order_id: '12', status_id: '2' } });
      reference.getStatus.mockResolvedValue({ type: 2, labels: ['w realizacji'] });
      reference.listStatuses.mockResolvedValue([{ statusId: '10', type: 4, labels: ['anulowane'] }]);

      await expect(adapter.write({ type: 'cancelled', externalOrderId: '12' })).resolves.toEqual({
        outcome: 'applied',
      });
      expect(put).toHaveBeenCalledWith('/orders/12', { status_id: 10 });
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

import {
  OrderSyncStartUnavailableError,
  isOrderFeedBootstrap,
  isOrderFeedDateBootstrap,
  isOrderWindowReader,
} from '@openlinker/core/orders';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperOrderRow } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import { formatShoperFeedCursor } from '../../../mappers/shoper-order-feed-cursor.mapper';
import { orderMarker } from '../../../mappers/shoper-order-input.mapper';
import type { ShoperOrderReferenceProvider } from '../../../shop-context/shoper-order-reference.provider';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { ShoperOrderSourceAdapter } from '../shoper-order-source.adapter';
import { WARSAW, buildOrderRow } from './shoper-order-source-test-data';

function envelope<T>(list: readonly T[]): { status: number; data: unknown } {
  return { status: 200, data: { count: String(list.length), pages: 1, page: 1, list } };
}

function setup(): { adapter: ShoperOrderSourceAdapter; get: jest.Mock } {
  const get = jest.fn();
  const reference = {
    getStatus: jest.fn().mockResolvedValue({ type: 3, labels: ['x'] }),
  };
  const shopContext = { get: jest.fn().mockResolvedValue({ timezone: WARSAW }) };
  const adapter = new ShoperOrderSourceAdapter(
    { get } as unknown as ShoperHttpClient,
    reference as unknown as ShoperOrderReferenceProvider,
    shopContext as unknown as ShoperShopContextProvider,
    { id: 'conn-1' } as Connection,
  );
  return { adapter, get };
}

/** Answers by sort so the head's two reads (order_id DESC, status_date DESC) can differ. */
function shop(get: jest.Mock, rows: { byId?: readonly ShoperOrderRow[]; byStatus?: readonly ShoperOrderRow[] }): void {
  get.mockImplementation((_path: string, query: Record<string, string | number>) => {
    if (query.order === 'status_date DESC') return Promise.resolve(envelope(rows.byStatus ?? []));
    return Promise.resolve(envelope(rows.byId ?? []));
  });
}

describe('ShoperOrderSourceAdapter order sync start (#4265)', () => {
  describe('headCursor', () => {
    it('should turn a refused head read into a deterministic start error', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'Unable to sort by this field.'));

      await expect(adapter.headCursor()).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should turn a refused status-date read into a deterministic start error', async () => {
      const { adapter, get } = setup();
      get.mockImplementation((_path: string, query: Record<string, string | number>) =>
        query.order === 'status_date DESC'
          ? Promise.reject(new ShoperApiError(422, 'validation_error', 'bad sort'))
          : Promise.resolve(envelope([{ order_id: 9, date: '2026-09-30 10:00:00' } as unknown as ShoperOrderRow])),
      );

      await expect(adapter.headCursor()).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should return null when the shop has no orders', async () => {
      const { adapter, get } = setup();
      shop(get, {});

      await expect(adapter.headCursor()).resolves.toBeNull();
    });

    it('should seed the order id and the later status watermark so the first poll replays nothing', async () => {
      const { adapter, get } = setup();
      shop(get, {
        byId: [buildOrderRow({ order_id: '100', status_date: '2026-09-28 06:00:00' })],
        byStatus: [buildOrderRow({ order_id: '90', status_date: '2026-09-29 10:00:00' })],
      });

      const cursor = await adapter.headCursor();

      expect(get).toHaveBeenCalledWith('/orders', { order: 'order_id DESC', limit: 1, page: 1 });
      expect(cursor).toBe(
        formatShoperFeedCursor({
          lastOrderId: '100',
          statusWatermark: '2026-09-29 10:00:00',
          statusPassStart: null,
          statusNextPage: null,
        }),
      );
    });

    it('should pick the head by numeric id even when it is one of our own orders', async () => {
      const { adapter, get } = setup();
      shop(get, { byId: [buildOrderRow({ order_id: '9', notes_priv: orderMarker('x') })] });

      await expect(adapter.headCursor()).resolves.toMatch(/^v2\|9\|/);
    });

    it('should propagate a failed read instead of reporting an empty shop', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValue(new Error('boom'));

      await expect(adapter.headCursor()).rejects.toThrow('boom');
    });
  });

  describe('cursorForDate', () => {
    it('should place the cursor just before the first order at or after the date', async () => {
      const { adapter, get } = setup();
      shop(get, {
        byId: [buildOrderRow({ order_id: '40', date: '2026-09-30 08:15:00' })],
        byStatus: [buildOrderRow({ status_date: '2026-10-01 08:00:00' })],
      });

      const cursor = await adapter.cursorForDate('2026-09-30');

      expect(get).toHaveBeenCalledWith('/orders', {
        order: 'order_id ASC',
        filters: JSON.stringify({ date: { '>=': '2026-09-30 00:00:00' } }),
        limit: 1,
        page: 1,
      });
      expect(cursor).toBe(
        formatShoperFeedCursor({
          lastOrderId: '39',
          statusWatermark: '2026-10-01 08:00:00',
          statusPassStart: null,
          statusNextPage: null,
        }),
      );
    });

    it('should fall back to the head when no order is that recent', async () => {
      const { adapter, get } = setup();
      get.mockImplementation((_p: string, query: Record<string, string | number>) =>
        Promise.resolve(
          envelope(
            query.filters !== undefined ? [] : [buildOrderRow({ order_id: '55', status_date: '2026-09-01 00:00:00' })],
          ),
        ),
      );

      await expect(adapter.cursorForDate('2030-01-01')).resolves.toMatch(/^v2\|55\|/);
    });

    it('should start an empty shop at "nothing older than now", not at the beginning', async () => {
      const { adapter, get } = setup();
      shop(get, {});

      const cursor = await adapter.cursorForDate('2026-09-30');

      expect(cursor).toBe(
        formatShoperFeedCursor({ lastOrderId: '0', statusWatermark: null, statusPassStart: null, statusNextPage: null }),
      );
      expect(cursor).not.toBe('v2||||');
    });

    it('should take the day of an ISO instant', async () => {
      const { adapter, get } = setup();
      shop(get, { byId: [buildOrderRow({ order_id: '40', date: '2026-09-30 08:15:00' })] });

      await adapter.cursorForDate('2026-09-30T14:00:00+02:00');

      expect(get).toHaveBeenCalledWith(
        '/orders',
        expect.objectContaining({ filters: JSON.stringify({ date: { '>=': '2026-09-30 00:00:00' } }) }),
      );
    });

    it('should refuse when the shop ignored the date filter and returned an older order', async () => {
      const { adapter, get } = setup();
      shop(get, { byId: [buildOrderRow({ order_id: '1', date: '2026-01-02 10:00:00' })] });

      await expect(adapter.cursorForDate('2026-09-30')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it.each(['2026-13-45', '2026-02-30', '2026-9-3', ''])('should refuse the date %p', async (value) => {
      const { adapter, get } = setup();

      await expect(adapter.cursorForDate(value)).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
      expect(get).not.toHaveBeenCalled();
    });

    it('should refuse a date it cannot read', async () => {
      const { adapter } = setup();

      await expect(adapter.cursorForDate('yesterday')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should turn a refused date filter into a deterministic start error', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'Unable to filter by this field.'));

      await expect(adapter.cursorForDate('2026-09-30')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should treat a 422 as a deterministic refusal too', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValue(new ShoperApiError(422, 'validation_error', 'bad filter'));

      await expect(adapter.cursorForDate('2026-09-30')).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it('should let a transient failure through so the job retries', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValue(new Error('timeout'));

      await expect(adapter.cursorForDate('2026-09-30')).rejects.toThrow('timeout');
    });

    it.each([429, 500, 502, 503])('should rethrow HTTP %d untouched, not call it a refused date', async (status) => {
      const { adapter, get } = setup();
      const failure = new ShoperApiError(status, 'server_error');
      get.mockRejectedValue(failure);

      const rejected = adapter.cursorForDate('2026-09-30');
      await expect(rejected).rejects.toBe(failure);
      await expect(rejected).rejects.not.toBeInstanceOf(OrderSyncStartUnavailableError);
    });

    it.each([401, 403])('should rethrow HTTP %d so the connection is flagged for re-authentication', async (status) => {
      const { adapter, get } = setup();
      const failure = new ShoperApiError(status, 'invalid_client');
      get.mockRejectedValue(failure);

      const rejected = adapter.cursorForDate('2026-09-30');
      await expect(rejected).rejects.toBe(failure);
      expect(failure.isAuthRejection()).toBe(true);
    });
  });

  describe('listOrdersInWindow', () => {
    it('should read oldest first with date bounds and no keyset on the first page', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '5' }), buildOrderRow({ order_id: '6' })]));

      const page = await adapter.listOrdersInWindow({
        from: '2026-09-01',
        to: '2026-09-30',
        direction: 'oldest-first',
        cursor: null,
        limit: 2,
      });

      expect(get).toHaveBeenCalledWith('/orders', {
        order: 'order_id ASC',
        filters: JSON.stringify({ date: { '>=': '2026-09-01 00:00:00', '<=': '2026-09-30 23:59:59' } }),
        limit: 2,
        page: 1,
      });
      expect(page.items.map((i) => i.eventKey)).toEqual(['5:created', '6:created']);
      expect(page).toMatchObject({ nextCursor: 'id:6', done: false });
    });

    it('should walk newest first with a descending keyset and finish on a short page', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([buildOrderRow({ order_id: '3' })]));

      const page = await adapter.listOrdersInWindow({ direction: 'newest-first', cursor: 'id:4', limit: 10 });

      expect(get).toHaveBeenCalledWith('/orders', {
        order: 'order_id DESC',
        filters: JSON.stringify({ order_id: { '<': '4' } }),
        limit: 10,
        page: 1,
      });
      expect(page).toEqual(expect.objectContaining({ nextCursor: null, done: true }));
    });

    it('should advance over our own orders without emitting them', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(
        envelope([buildOrderRow({ order_id: '8', notes_priv: orderMarker('x') }), buildOrderRow({ order_id: '9' })]),
      );

      const page = await adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 2 });

      expect(page.items.map((i) => i.externalOrderId)).toEqual(['9']);
      expect(page.nextCursor).toBe('id:9');
    });

    it("should clamp the page to Shoper's ceiling", async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(envelope([]));

      await adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 500 });

      expect(get).toHaveBeenCalledWith('/orders', expect.objectContaining({ limit: 50 }));
    });

    it('should clamp the limit and judge done against the clamped value on a non-empty page', async () => {
      const { adapter, get } = setup();
      // 50 rows is a full page at the clamped limit, so more may follow; against the raw 500 it would read as done.
      const rows = Array.from({ length: 50 }, (_, i) => buildOrderRow({ order_id: String(100 + i) }));
      get.mockResolvedValue(envelope(rows));

      const page = await adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: null, limit: 500 });

      expect(get).toHaveBeenCalledWith('/orders', expect.objectContaining({ limit: 50 }));
      expect(page.done).toBe(false);
      expect(page.nextCursor).toBe('id:149');
      expect(page.items).toHaveLength(50);
    });

    it('should map a 400 on the window read to the typed error and rethrow anything else', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValueOnce(new ShoperApiError(400, 'invalid_request', 'Unable to filter'));
      await expect(
        adapter.listOrdersInWindow({ from: '2026-09-01', direction: 'oldest-first', cursor: null, limit: 5 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);

      const throttled = new ShoperApiError(429, 'too_many_requests');
      get.mockRejectedValueOnce(throttled);
      await expect(
        adapter.listOrdersInWindow({ from: '2026-09-01', direction: 'oldest-first', cursor: null, limit: 5 }),
      ).rejects.toBe(throttled);

      const unauthorised = new ShoperApiError(401, 'invalid_client');
      get.mockRejectedValueOnce(unauthorised);
      await expect(
        adapter.listOrdersInWindow({ from: '2026-09-01', direction: 'oldest-first', cursor: null, limit: 5 }),
      ).rejects.toBe(unauthorised);
    });

    it('should refuse malformed or impossible bounds with the typed error', async () => {
      const { adapter, get } = setup();
      await expect(
        adapter.listOrdersInWindow({ from: '2026-13-45', direction: 'oldest-first', cursor: null, limit: 5 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
      await expect(
        adapter.listOrdersInWindow({ to: 'soon', direction: 'oldest-first', cursor: null, limit: 5 }),
      ).rejects.toBeInstanceOf(OrderSyncStartUnavailableError);
      expect(get).not.toHaveBeenCalled();
    });

    it('should drop a row the shop returned outside the window but still advance past it', async () => {
      const { adapter, get } = setup();
      get.mockResolvedValue(
        envelope([
          buildOrderRow({ order_id: '10', date: '2026-08-15 10:00:00' }),
          buildOrderRow({ order_id: '11', date: '2026-09-10 10:00:00' }),
        ]),
      );

      const page = await adapter.listOrdersInWindow({
        from: '2026-09-01',
        to: '2026-09-30',
        direction: 'oldest-first',
        cursor: null,
        limit: 2,
      });

      expect(page.items.map((i) => i.externalOrderId)).toEqual(['11']);
      expect(page.nextCursor).toBe('id:11');
    });

    it('should refuse a cursor it did not write', async () => {
      const { adapter } = setup();

      await expect(
        adapter.listOrdersInWindow({ direction: 'oldest-first', cursor: 'nope', limit: 10 }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('order start capabilities', () => {
    it('should be detected by the core guards', () => {
      const { adapter } = setup();
      expect(isOrderFeedBootstrap(adapter)).toBe(true);
      expect(isOrderFeedDateBootstrap(adapter)).toBe(true);
      expect(isOrderWindowReader(adapter)).toBe(true);
    });
  });
});

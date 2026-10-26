import type { Connection } from '@openlinker/core/identifier-mapping';
import type { CachePort } from '@openlinker/shared';
import { InMemoryCacheAdapter } from '@openlinker/shared/cache/testing';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperOrderStatusEntry } from '../../../../domain/types/shoper-order-status.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperOrderReferenceProvider } from '../../../shop-context/shoper-order-reference.provider';
import { ShoperParcelShippingRefusalProvider } from '../../../shop-context/shoper-parcel-shipping-refusal.provider';
import { ShoperOrderStatusWriter } from '../shoper-order-status-writer';

/** The trial shop's shippings: 1-5 carrier-integrated, 8 the plain `personal` one. */
const SHIPPINGS = [
  { shipping_id: '1', engine: 'inpost', active: '1' },
  { shipping_id: '4', engine: 'dpd', active: '1' },
  { shipping_id: '7', engine: 'personal', active: '0' },
  { shipping_id: '8', engine: 'personal', active: '1' },
];

/** Shoper's 11 statuses in their four types, as the trial shop lists them. */
const STATUSES: ShoperOrderStatusEntry[] = [
  { statusId: '1', type: 1, labels: ['złożone'] },
  { statusId: '2', type: 2, labels: ['przyjęte do realizacji'] },
  { statusId: '3', type: 2, labels: ['oczekuje na dostawę'] },
  { statusId: '4', type: 2, labels: ['w przygotowaniu'] },
  { statusId: '5', type: 2, labels: ['gotowe do wysłania'], active: false },
  { statusId: '6', type: 4, labels: ['zwrócone'] },
  { statusId: '7', type: 3, labels: ['przesyłka wysłana'] },
  { statusId: '8', type: 4, labels: ['odrzucone'] },
  { statusId: '9', type: 3, labels: ['przesyłka odebrana'] },
  { statusId: '10', type: 4, labels: ['anulowane'] },
  { statusId: '11', type: 1, labels: ['nieopłacone'] },
];

interface Shop {
  parcels?: readonly Record<string, unknown>[];
  order?: Record<string, unknown> | null;
  shippings?: readonly Record<string, unknown>[];
  config?: Record<string, unknown>;
  /** The host cache the refusal memory reads through; absent = per-instance memory only. */
  cache?: CachePort;
}

/** Shoper's live answer to a parcel under a carrier-integrated shipping method. */
const methodRefused = (): ShoperApiError =>
  new ShoperApiError(400, 'invalid_request', 'Nie znaleziono wartości');

/** The `shipping_id` of every `POST /parcels`, in call order. */
const postedShippingIds = (post: jest.Mock): unknown[] =>
  post.mock.calls.map((call) => (call as [string, { shipping_id: number }])[1].shipping_id);

const REFUSAL_KEY_PREFIX = 'shoper:parcel-shipping-refusal:conn-1';

interface Harness {
  writer: ShoperOrderStatusWriter;
  get: jest.Mock;
  post: jest.Mock;
  put: jest.Mock;
  reference: { getStatus: jest.Mock; listStatuses: jest.Mock };
}

function setup(shop: Shop = {}): Harness {
  const order = shop.order === undefined ? { order_id: '10', shipping_id: '1', status_id: '2' } : shop.order;
  const get = jest.fn().mockImplementation((path: string) => {
    if (path === '/parcels') return Promise.resolve({ status: 200, data: { list: shop.parcels ?? [] } });
    if (path === '/orders/10') {
      return order === null
        ? Promise.reject(new ShoperApiError(404, 'invalid_request', 'Resource not found'))
        : Promise.resolve({ status: 200, data: order });
    }
    if (path === '/shippings') {
      const list = shop.shippings ?? SHIPPINGS;
      return Promise.resolve({ status: 200, data: { count: String(list.length), pages: 1, page: 1, list } });
    }
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
  const post = jest.fn().mockResolvedValue({ status: 200, data: 3 });
  const put = jest.fn().mockResolvedValue({ status: 200, data: 1 });
  const reference = {
    getStatus: jest.fn().mockImplementation((id: string) =>
      Promise.resolve(STATUSES.find((s) => s.statusId === id) ?? null),
    ),
    listStatuses: jest.fn().mockResolvedValue(STATUSES),
  };
  const writer = new ShoperOrderStatusWriter(
    { get, post, put, delete: jest.fn() } as unknown as ShoperHttpClient,
    { id: 'conn-1', config: shop.config ?? {} } as unknown as Connection,
    reference as unknown as ShoperOrderReferenceProvider,
    new ShoperParcelShippingRefusalProvider({ cache: shop.cache, keyPrefix: REFUSAL_KEY_PREFIX }),
  );
  return { writer, get, post, put, reference };
}

describe('ShoperOrderStatusWriter', () => {
  describe('dispatched', () => {
    it("should write the parcel under the order's own shipping method when Shoper accepts it", async () => {
      // The order uses 1 (InPost): it is tried first, whatever its engine, and a
      // configured fallback is not consulted when Shoper takes the parcel.
      const h = setup({ config: { defaults: { parcelShippingId: 8 } } });

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: ' 6200000000001 ' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(h.post).toHaveBeenCalledTimes(1);
      expect(h.post).toHaveBeenCalledWith('/parcels', {
        order_id: 10,
        shipping_id: 1,
        shipping_code: '6200000000001',
        sent: true,
      });
      expect(h.get).not.toHaveBeenCalledWith('/shippings', expect.anything());
    });

    it('should fall back to the configured method when Shoper refuses the order carrier', async () => {
      const h = setup({ config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValueOnce(methodRefused());

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(postedShippingIds(h.post)).toEqual([1, 8]);
      expect(h.get).not.toHaveBeenCalledWith('/shippings', expect.anything());
    });

    it('should fall back to the first active plain method when the order carrier is refused and nothing is configured', async () => {
      const h = setup();
      h.post.mockRejectedValueOnce(methodRefused());

      await expect(h.writer.write({ type: 'dispatched', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });

      // 7 is personal but inactive, so 8 is the first usable one.
      expect(h.post).toHaveBeenLastCalledWith('/parcels', { order_id: 10, shipping_id: 8, sent: true });
      expect(postedShippingIds(h.post)).toEqual([1, 8]);
    });

    it('should go straight to the fallback for a carrier Shoper already refused, across adapter instances', async () => {
      // Two writers over one host cache stand in for two `getCapabilityAdapter`
      // bags: the refusal learnt by the first must spare the second the call.
      const cache = new InMemoryCacheAdapter();
      const first = setup({ cache, config: { defaults: { parcelShippingId: 8 } } });
      first.post.mockRejectedValueOnce(methodRefused());
      await first.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      const second = setup({ cache, config: { defaults: { parcelShippingId: 8 } } });
      await expect(
        second.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(postedShippingIds(second.post)).toEqual([8]);
    });

    it('should try the order carrier again on every bag when no cache is wired', async () => {
      // A fresh bag per dispatch remembers nothing without the host cache.
      for (let bagIndex = 0; bagIndex < 2; bagIndex += 1) {
        const bag = setup({ config: { defaults: { parcelShippingId: 8 } } });
        bag.post.mockRejectedValueOnce(methodRefused());

        await expect(
          bag.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
        ).resolves.toEqual({ outcome: 'applied' });
        expect(postedShippingIds(bag.post)).toEqual([1, 8]);
      }
    });

    it('should remember a refusal within one bag even without a cache', async () => {
      const h = setup({ config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValueOnce(methodRefused());

      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });
      h.post.mockClear();
      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(postedShippingIds(h.post)).toEqual([8]);
    });

    it('should try the order carrier when the cache cannot be read', async () => {
      const cache: CachePort = {
        get: jest.fn().mockRejectedValue(new Error('redis down')),
        set: jest.fn().mockRejectedValue(new Error('redis down')),
        delete: jest.fn(),
      };
      const h = setup({ cache, config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValueOnce(methodRefused());

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(postedShippingIds(h.post)).toEqual([1, 8]);
    });

    it('should not fall back on any other 400, and remember nothing', async () => {
      const cache = new InMemoryCacheAdapter();
      const h = setup({ cache, config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValueOnce(new ShoperApiError(400, 'invalid_request', 'shipping_code: too long'));

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({ outcome: 'rejected', detail: expect.stringContaining('too long') });
      expect(postedShippingIds(h.post)).toEqual([1]);
      const refusals = new ShoperParcelShippingRefusalProvider({ cache, keyPrefix: REFUSAL_KEY_PREFIX });
      await expect(refusals.isRefused(1)).resolves.toBe(false);
    });

    it('should not fall back when the parcel call fails other than with a 400', async () => {
      const h = setup({ config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValueOnce(new ShoperApiError(503, 'server_error', 'unavailable'));

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({ outcome: 'rejected', detail: expect.stringContaining('unavailable') });
      expect(postedShippingIds(h.post)).toEqual([1]);
    });

    it('should go straight to the fallback for an order with no shipping method', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: null, status_id: '2' } });

      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(postedShippingIds(h.post)).toEqual([8]);
    });

    it('should reject, naming the config key, when the order carrier is refused and the shop has no plain method', async () => {
      const h = setup({ shippings: [{ shipping_id: '1', engine: 'inpost', active: '1' }] });
      h.post.mockRejectedValueOnce(methodRefused());

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('defaults.parcelShippingId');
      expect(postedShippingIds(h.post)).toEqual([1]);
    });

    it('should reject, naming the config key, when the configured fallback is refused too', async () => {
      const h = setup({ config: { defaults: { parcelShippingId: 4 } } });
      h.post.mockRejectedValue(methodRefused());

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('Nie znaleziono wartości');
      expect(result.detail).toContain('defaults.parcelShippingId');
      // One try of the order carrier, one of the fallback; never a loop.
      expect(postedShippingIds(h.post)).toEqual([1, 4]);
    });

    it('should not write a parcel when the order already has one for this dispatch, whatever its carrier', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: 'T1' }] });
      h.post.mockRejectedValue(methodRefused());

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should report a non-400 parcel failure as rejected with the reason', async () => {
      const h = setup({ config: { defaults: { parcelShippingId: 8 } } });
      h.post.mockRejectedValue(new ShoperApiError(500, 'server_error', 'boom'));

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({ outcome: 'rejected', detail: expect.stringContaining('boom') });
    });

    it('should not send products, so Shoper ships the whole remainder', async () => {
      const h = setup();

      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect((h.post.mock.calls[0] as [string, Record<string, unknown>])[1]).not.toHaveProperty('products');
    });

    it('should write nothing when a parcel already carries the same tracking number', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: 'T1' }] });

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'applied' });

      expect(h.post).not.toHaveBeenCalled();
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should write nothing on a re-delivered dispatch without tracking when a parcel exists', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: null }] });

      await expect(h.writer.write({ type: 'dispatched', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });

      expect(h.post).not.toHaveBeenCalled();
    });

    it('should attach a late tracking number to the untracked parcel instead of creating another', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: '' }] });

      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T2' });

      expect(h.put).toHaveBeenCalledWith('/parcels/5', { shipping_code: 'T2', sent: true });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should send only the tracking number to a parcel Shoper already reports as sent', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: '', sent: '1' }] });

      await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T2' });

      expect(h.put).toHaveBeenCalledWith('/parcels/5', { shipping_code: 'T2' });
    });

    it('should reject, writing nothing, when a parcel exists under a different tracking number', async () => {
      const h = setup({ parcels: [{ parcel_id: '5', order_id: '10', shipping_code: 'T1' }] });

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T2' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('different tracking number');
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should reject, and write nothing, when the parcels filter returned another order', async () => {
      const h = setup({ parcels: [{ parcel_id: '9', order_id: '11', shipping_code: 'T1' }] });

      const result = await h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' });

      expect(result).toEqual({ outcome: 'rejected', detail: expect.stringContaining('was not honoured') });
      expect(h.post).not.toHaveBeenCalled();
    });

    it('should reject when the Shoper order does not exist', async () => {
      const h = setup({ order: null });

      await expect(
        h.writer.write({ type: 'dispatched', externalOrderId: '10', trackingNumber: 'T1' }),
      ).resolves.toEqual({ outcome: 'rejected', detail: 'Shoper order 10 not found' });
      expect(h.post).not.toHaveBeenCalled();
    });
  });

  describe('cancelled', () => {
    it('should move the order to the first active cancelled status, skipping a refund-labelled one', async () => {
      const h = setup();

      await expect(h.writer.write({ type: 'cancelled', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });

      // 6 ("zwrócone") is type 4 but a return; 8 ("odrzucone") is the first plain cancel.
      expect(h.put).toHaveBeenCalledWith('/orders/10', { status_id: 8 });
    });

    it('should use the configured cancelled status when one is set', async () => {
      const h = setup({ config: { defaults: { cancelledStatusId: 10 } } });

      await h.writer.write({ type: 'cancelled', externalOrderId: '10' });

      expect(h.put).toHaveBeenCalledWith('/orders/10', { status_id: 10 });
      expect(h.reference.listStatuses).not.toHaveBeenCalled();
    });

    it('should write nothing when the order is already in a not-completed status', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: '1', status_id: '6' } });

      await expect(h.writer.write({ type: 'cancelled', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should refuse to cancel an order the shop already completed', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: '1', status_id: '7' } });

      const result = await h.writer.write({ type: 'cancelled', externalOrderId: '10' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('already completed');
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should reject, naming the config key, when the shop lists no plain cancelled status', async () => {
      const h = setup();
      h.reference.listStatuses.mockResolvedValue(STATUSES.filter((s) => s.type !== 4 || s.statusId === '6'));

      const result = await h.writer.write({ type: 'cancelled', externalOrderId: '10' });

      expect(result.outcome).toBe('rejected');
      expect(result.detail).toContain('defaults.cancelledStatusId');
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should report a failed status write as rejected, not throw', async () => {
      const h = setup();
      h.put.mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'status_id invalid'));

      await expect(h.writer.write({ type: 'cancelled', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'rejected',
        detail: expect.stringContaining('status_id invalid'),
      });
    });
  });

  describe('in-progress', () => {
    it('should move a new order to the first active in-progress status', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: '1', status_id: '1' } });

      await h.writer.write({ type: 'in-progress', externalOrderId: '10' });

      expect(h.put).toHaveBeenCalledWith('/orders/10', { status_id: 2 });
    });

    it('should use the configured in-progress status when one is set', async () => {
      const h = setup({
        order: { order_id: '10', shipping_id: '1', status_id: '1' },
        config: { defaults: { inProgressStatusId: 4 } },
      });

      await h.writer.write({ type: 'in-progress', externalOrderId: '10' });

      expect(h.put).toHaveBeenCalledWith('/orders/10', { status_id: 4 });
    });

    it('should write nothing when the order is already in progress', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: '1', status_id: '3' } });

      await expect(h.writer.write({ type: 'in-progress', externalOrderId: '10' })).resolves.toEqual({
        outcome: 'applied',
      });
      expect(h.put).not.toHaveBeenCalled();
    });

    it('should not move a completed order back to in progress', async () => {
      const h = setup({ order: { order_id: '10', shipping_id: '1', status_id: '9' } });

      const result = await h.writer.write({ type: 'in-progress', externalOrderId: '10' });

      expect(result.outcome).toBe('rejected');
      expect(h.put).not.toHaveBeenCalled();
    });
  });

  it('should report delivered as unsupported, because Shoper has no delivered status', async () => {
    const h = setup();

    const result = await h.writer.write({ type: 'delivered', externalOrderId: '10' });

    expect(result.outcome).toBe('unsupported');
    expect(result.detail).toBeDefined();
    expect(h.get).not.toHaveBeenCalled();
  });

  it('should reject a non-numeric order id without calling the shop', async () => {
    const h = setup();

    const result = await h.writer.write({ type: 'cancelled', externalOrderId: '../users' });

    expect(result.outcome).toBe('rejected');
    expect(h.get).not.toHaveBeenCalled();
  });
});

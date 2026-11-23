/**
 * Mirakl Inventory Master Adapter: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared/cache';
import { MiraklApiException } from '../../../../domain/exceptions/mirakl-api.exception';
import { MiraklNotSupportedException } from '../../../../domain/exceptions/mirakl-not-supported.exception';
import type { MiraklFileUpload } from '../../../http/mirakl-http-client.types';
import { MiraklInventoryMasterAdapter } from '../mirakl-inventory-master.adapter';
import { MiraklOfferReader } from '../mirakl-offer-reader';
import { CONNECTION_ID, fakeIdentity, fakeOffers } from './mirakl-master.fixture';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function memoryCache(): CachePort & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    get: <T>(key: string): Promise<T | null> => Promise.resolve((store.get(key) as T) ?? null),
    set: <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string): Promise<void> => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as CachePort & { store: Map<string, unknown> };
}

function setup(
  options: { quantity?: number; cache?: CachePort; lock?: SyncLockPort; now?: () => Date } = {}
): { adapter: MiraklInventoryMasterAdapter; http: ReturnType<typeof fakeOffers> } {
  const http = fakeOffers([{ shop_sku: 'A', quantity: options.quantity ?? 10 }]);
  const { identity } = fakeIdentity();
  const adapter = new MiraklInventoryMasterAdapter({
    connectionId: CONNECTION_ID,
    brand: 'Empik',
    httpClient: http.client,
    reader: new MiraklOfferReader(http.client),
    identity,
    cache: options.cache,
    lock: options.lock,
    now: options.now ?? ((): Date => NOW),
    sleep: () => Promise.resolve(),
  });
  return { adapter, http };
}

function submittedFile(http: ReturnType<typeof fakeOffers>, call = 0): string {
  const calls = http.postFile.mock.calls as Array<[string, MiraklFileUpload]>;
  const file = calls[call][1];
  return String(file.content);
}

describe('MiraklInventoryMasterAdapter reads', () => {
  it('should report the offer quantity as a pooled position of its single variant', async () => {
    const { adapter } = setup({ quantity: 6 });

    await expect(adapter.listInventory('ol_product_A')).resolves.toEqual([
      {
        id: 'ol_inventory_stock:A',
        productId: 'ol_product_A',
        variantId: 'ol_productvariant_A',
        quantity: 6,
        reserved: 0,
        available: 6,
      },
    ]);
    await expect(adapter.getAvailableQuantity('ol_product_A')).resolves.toBe(6);
  });

  it('should report a missing offer as deleted at the master', async () => {
    const { adapter } = setup();

    await expect(adapter.getInventory('ol_product_Z')).rejects.toBeInstanceOf(
      MasterProductNotFoundError
    );
  });
});

describe('MiraklInventoryMasterAdapter.adjustInventory', () => {
  it('should read the live quantity and submit current + delta as one STO01 line', async () => {
    const { adapter, http } = setup({ quantity: 10 });

    const result = await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -3 });

    expect(http.get).toHaveBeenCalledWith('/api/offers', { queryParams: { sku: 'A' } });
    expect(http.postFile).toHaveBeenCalledWith(
      '/api/offers/stock/imports',
      expect.objectContaining({ fieldName: 'file', contentType: 'text/csv' })
    );
    expect(submittedFile(http)).toBe('offer-sku;quantity\nA;7\n');
    expect(result).toMatchObject({
      quantity: 7,
      available: 7,
      adjustmentOutcome: { disposition: 'applied', idempotency: 'not_requested', appliedAt: null },
    });
  });

  it('should clamp a removal past zero', async () => {
    const { adapter, http } = setup({ quantity: 2 });

    const result = await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -5 });

    expect(submittedFile(http)).toBe('offer-sku;quantity\nA;0\n');
    expect(result.quantity).toBe(0);
  });

  it('should build on its own pending target while Mirakl has not applied it yet', async () => {
    const cache = memoryCache();
    const { adapter, http } = setup({ quantity: 10, cache });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });
    // OF21 still answers 10: the first import has not been applied.
    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });

    expect(submittedFile(http, 0)).toBe('offer-sku;quantity\nA;9\n');
    expect(submittedFile(http, 1)).toBe('offer-sku;quantity\nA;8\n');
    await expect(adapter.getAvailableQuantity('ol_product_A')).resolves.toBe(8);
  });

  it('should trust OF21 again once the pending target is stale', async () => {
    const cache = memoryCache();
    let now = NOW;
    const { adapter, http } = setup({ quantity: 10, cache, now: () => now });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });
    now = new Date(NOW.getTime() + 10 * 60_000);
    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });

    expect(submittedFile(http, 1)).toBe('offer-sku;quantity\nA;9\n');
  });

  it('should apply a key once and answer a repeat as deduplicated', async () => {
    const cache = memoryCache();
    const { adapter, http } = setup({ quantity: 10, cache });

    const first = await adapter.adjustInventory({
      productId: 'ol_product_A',
      quantity: -2,
      idempotencyKey: 'sale:1',
    });
    const second = await adapter.adjustInventory({
      productId: 'ol_product_A',
      quantity: -2,
      idempotencyKey: 'sale:1',
    });

    expect(http.postFile).toHaveBeenCalledTimes(1);
    expect(first.adjustmentOutcome).toMatchObject({
      disposition: 'applied',
      idempotency: 'honoured',
    });
    expect(second.adjustmentOutcome).toMatchObject({
      disposition: 'deduplicated',
      idempotency: 'honoured',
    });
    expect(second.quantity).toBe(8);
  });

  it('should not record the key when the submit fails', async () => {
    const cache = memoryCache();
    const { adapter, http } = setup({ quantity: 10, cache });
    http.postFile.mockRejectedValueOnce(new Error('network'));

    await expect(
      adapter.adjustInventory({ productId: 'ol_product_A', quantity: -2, idempotencyKey: 'k' })
    ).rejects.toThrow('network');
    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -2, idempotencyKey: 'k' });

    expect(http.postFile).toHaveBeenCalledTimes(2);
  });

  it('should report a key as unsupported without a cache', async () => {
    const { adapter } = setup();

    const result = await adapter.adjustInventory({
      productId: 'ol_product_A',
      quantity: 1,
      idempotencyKey: 'k',
    });

    expect(result.adjustmentOutcome?.idempotency).toBe('unsupported');
  });

  it('should hold the per-offer lock around the read and the write', async () => {
    const lock = {
      acquire: jest.fn().mockResolvedValue('token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn(),
    } as unknown as SyncLockPort & { acquire: jest.Mock; release: jest.Mock };
    const { adapter } = setup({ lock });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: 1 });

    expect(lock.acquire).toHaveBeenCalledWith(`mirakl:master-stock:${CONNECTION_ID}:A`, 30_000);
    expect(lock.release).toHaveBeenCalledWith(`mirakl:master-stock:${CONNECTION_ID}:A`, 'token');
  });

  it('should write nothing when the lock stays taken', async () => {
    const lock = {
      acquire: jest.fn().mockResolvedValue(null),
      release: jest.fn(),
      extend: jest.fn(),
    } as unknown as SyncLockPort;
    let tick = NOW.getTime();
    const { adapter, http } = setup({
      lock,
      now: () => {
        tick += 1_000;
        return new Date(tick);
      },
    });

    await expect(
      adapter.adjustInventory({ productId: 'ol_product_A', quantity: 1 })
    ).rejects.toBeInstanceOf(MiraklApiException);
    expect(http.postFile).not.toHaveBeenCalled();
  });

  it('should refuse to hold stock', async () => {
    const { adapter } = setup();

    await expect(adapter.reserveInventory('ol_product_A', 1, 'o1')).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
  });
});

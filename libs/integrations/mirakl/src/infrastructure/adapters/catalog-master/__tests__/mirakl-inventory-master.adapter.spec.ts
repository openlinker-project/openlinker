/**
 * Mirakl Inventory Master Adapter: unit tests (#4284)
 *
 * @module libs/integrations/mirakl/src/infrastructure/adapters/catalog-master
 */
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { CachePort } from '@openlinker/shared/cache';
import { MiraklApiException } from '../../../../domain/exceptions/mirakl-api.exception';
import { MiraklConfigException } from '../../../../domain/exceptions/mirakl-config.exception';
import { MiraklNotSupportedException } from '../../../../domain/exceptions/mirakl-not-supported.exception';
import type { MiraklOfferWriteRepositoryPort } from '../../../../domain/ports/mirakl-offer-write-repository.port';
import type { MiraklOfferWriteStatus } from '../../../../domain/types/mirakl-offer-write.types';
import type { IMiraklImportTracker } from '../../../imports/mirakl-import-tracker.interface';
import { MiraklInventoryMasterAdapter } from '../mirakl-inventory-master.adapter';
import { MiraklOfferReader } from '../mirakl-offer-reader';
import { CONNECTION_ID, fakeIdentity, fakeOffers } from './mirakl-master.fixture';

const NOW = new Date('2026-11-23T12:00:00.000Z');

function memoryCache(): CachePort {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string): Promise<T | null> => Promise.resolve((store.get(key) as T) ?? null),
    set: <T>(key: string, value: T): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string): Promise<void> => {
      store.delete(key);
      return Promise.resolve();
    },
  } as unknown as CachePort;
}

interface QueuedRow {
  offerSku: string;
  value: string;
  status: MiraklOfferWriteStatus;
}

type MemoryQueue = MiraklOfferWriteRepositoryPort & {
  rows: QueuedRow[];
  failNextRecord: () => void;
};

/** The write queue in memory: one pending row per offer, replaced in place. */
function memoryQueue(): MemoryQueue {
  const rows: QueuedRow[] = [];
  let failNext = false;
  return {
    rows,
    failNextRecord: (): void => {
      failNext = true;
    },
    recordPending: (
      _connectionId: string,
      _kind: string,
      values: ReadonlyArray<{ offerSku: string; value: string }>
    ): Promise<void> => {
      if (failNext) {
        failNext = false;
        return Promise.reject(new Error('db down'));
      }
      for (const value of values) {
        const pending = rows.find(
          (row) => row.offerSku === value.offerSku && row.status === 'pending'
        );
        if (pending) {
          pending.value = value.value;
        } else {
          rows.push({ offerSku: value.offerSku, value: value.value, status: 'pending' });
        }
      }
      return Promise.resolve();
    },
    findLatest: (_connectionId: string, _kind: string, sku: string): Promise<QueuedRow | null> =>
      Promise.resolve([...rows].reverse().find((row) => row.offerSku === sku) ?? null),
  } as unknown as MemoryQueue;
}

interface SetupOptions {
  quantity?: number;
  cache?: CachePort;
  lock?: SyncLockPort;
  now?: () => Date;
  /** `null` builds the adapter without a queue. */
  queue?: MemoryQueue | null;
}

function setup(options: SetupOptions = {}): {
  adapter: MiraklInventoryMasterAdapter;
  http: ReturnType<typeof fakeOffers>;
  queue: MemoryQueue;
} {
  const http = fakeOffers([{ shop_sku: 'A', quantity: options.quantity ?? 10 }]);
  const { identity } = fakeIdentity();
  const queue = options.queue ?? memoryQueue();
  const adapter = new MiraklInventoryMasterAdapter({
    connectionId: CONNECTION_ID,
    brand: 'Empik',
    httpClient: http.client,
    importTracker: {} as unknown as IMiraklImportTracker,
    writes: options.queue === null ? undefined : queue,
    reader: new MiraklOfferReader(http.client),
    identity,
    cache: options.cache,
    lock: options.lock,
    now: options.now ?? ((): Date => NOW),
    sleep: () => Promise.resolve(),
  });
  return { adapter, http, queue };
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

  it('should report a queued target instead of the stale OF21 number', async () => {
    const { adapter, queue } = setup({ quantity: 10 });
    queue.rows.push({ offerSku: 'A', value: '4', status: 'submitted' });

    await expect(adapter.getAvailableQuantity('ol_product_A')).resolves.toBe(4);
  });

  it('should report a missing offer as deleted at the master', async () => {
    const { adapter } = setup();

    await expect(adapter.getInventory('ol_product_Z')).rejects.toBeInstanceOf(
      MasterProductNotFoundError
    );
  });
});

describe('MiraklInventoryMasterAdapter.adjustInventory', () => {
  it('should read the live quantity and queue current + delta, sending nothing itself', async () => {
    const { adapter, http, queue } = setup({ quantity: 10 });

    const result = await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -3 });

    expect(http.get).toHaveBeenCalledWith('/api/offers', { queryParams: { sku: 'A' } });
    expect(http.postFile).not.toHaveBeenCalled();
    expect(queue.rows).toEqual([{ offerSku: 'A', value: '7', status: 'pending' }]);
    expect(result).toMatchObject({
      quantity: 7,
      available: 7,
      adjustmentOutcome: { disposition: 'applied', idempotency: 'not_requested', appliedAt: null },
    });
  });

  it('should clamp a removal past zero', async () => {
    const { adapter, queue } = setup({ quantity: 2 });

    const result = await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -5 });

    expect(queue.rows[0].value).toBe('0');
    expect(result.quantity).toBe(0);
  });

  it('should build on a queued target that has not reached Mirakl yet', async () => {
    const { adapter, queue } = setup({ quantity: 10 });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });
    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: 3 });

    expect(queue.rows).toEqual([{ offerSku: 'A', value: '12', status: 'pending' }]);
  });

  it('should build on a sent target Mirakl has not settled', async () => {
    const { adapter, queue } = setup({ quantity: 10 });
    queue.rows.push({ offerSku: 'A', value: '8', status: 'submitted' });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });

    expect(queue.rows.at(-1)).toEqual({ offerSku: 'A', value: '7', status: 'pending' });
  });

  it('should trust OF21 again once the write is settled', async () => {
    const { adapter, queue } = setup({ quantity: 9 });
    queue.rows.push({ offerSku: 'A', value: '8', status: 'applied' });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: -1 });

    expect(queue.rows.at(-1)).toEqual({ offerSku: 'A', value: '8', status: 'pending' });
  });

  it('should apply a key once and answer a repeat as deduplicated', async () => {
    const { adapter, queue } = setup({ quantity: 10, cache: memoryCache() });

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

    expect(queue.rows).toEqual([{ offerSku: 'A', value: '8', status: 'pending' }]);
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

  it('should not record the key when queueing fails', async () => {
    const queue = memoryQueue();
    const { adapter } = setup({ quantity: 10, cache: memoryCache(), queue });
    queue.failNextRecord();

    await expect(
      adapter.adjustInventory({ productId: 'ol_product_A', quantity: -2, idempotencyKey: 'k' })
    ).rejects.toThrow('db down');
    const retry = await adapter.adjustInventory({
      productId: 'ol_product_A',
      quantity: -2,
      idempotencyKey: 'k',
    });

    expect(retry.adjustmentOutcome?.disposition).toBe('applied');
    expect(queue.rows).toEqual([{ offerSku: 'A', value: '8', status: 'pending' }]);
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

  it('should refuse to write without the queue rather than send directly', async () => {
    const { adapter, http } = setup({ queue: null });

    await expect(
      adapter.adjustInventory({ productId: 'ol_product_A', quantity: 1 })
    ).rejects.toBeInstanceOf(MiraklConfigException);
    expect(http.postFile).not.toHaveBeenCalled();
  });

  it('should hold the per-offer lock around the read and the queue write', async () => {
    const acquire = jest.fn().mockResolvedValue('token');
    const release = jest.fn().mockResolvedValue(true);
    const lock = { acquire, release, extend: jest.fn() } as unknown as SyncLockPort;
    const { adapter } = setup({ lock });

    await adapter.adjustInventory({ productId: 'ol_product_A', quantity: 1 });

    expect(acquire).toHaveBeenCalledWith(`mirakl:master-stock:${CONNECTION_ID}:A`, 30_000);
    expect(release).toHaveBeenCalledWith(`mirakl:master-stock:${CONNECTION_ID}:A`, 'token');
  });

  it('should queue nothing when the lock stays taken', async () => {
    const lock = {
      acquire: jest.fn().mockResolvedValue(null),
      release: jest.fn(),
      extend: jest.fn(),
    } as unknown as SyncLockPort;
    let tick = NOW.getTime();
    const { adapter, queue } = setup({
      lock,
      now: () => {
        tick += 1_000;
        return new Date(tick);
      },
    });

    await expect(
      adapter.adjustInventory({ productId: 'ol_product_A', quantity: 1 })
    ).rejects.toBeInstanceOf(MiraklApiException);
    expect(queue.rows).toEqual([]);
  });

  it('should refuse to hold stock', async () => {
    const { adapter } = setup();

    await expect(adapter.reserveInventory('ol_product_A', 1, 'o1')).rejects.toBeInstanceOf(
      MiraklNotSupportedException
    );
  });
});

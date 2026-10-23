import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { isBulkInventoryReader } from '@openlinker/core/inventory';
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperInvalidStockLevelException } from '../../../../domain/exceptions/shoper-invalid-stock-level.exception';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import { ShoperNotMappedException } from '../../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperStockNotFoundException } from '../../../../domain/exceptions/shoper-stock-not-found.exception';
import { ShoperVariantRequiredException } from '../../../../domain/exceptions/shoper-variant-required.exception';
import { ShoperWarehousesNotSupportedException } from '../../../../domain/exceptions/shoper-warehouses-not-supported.exception';
import {
  MAP_CONTEXT,
  buildProduct,
  buildStock,
  envelope,
} from '../../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import { ShoperProductReader } from '../../../readers/shoper-product.reader';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { ShoperInventoryMasterAdapter } from '../shoper-inventory-master.adapter';

const CONNECTION_ID = 'conn-1';
/** A 404 carrying Shoper's own envelope - its statement that the resource is gone. */
const NOT_FOUND = new ShoperApiError(404, 'invalid_request', 'Resource not found');

function setup(context = MAP_CONTEXT): {
  adapter: ShoperInventoryMasterAdapter;
  get: jest.Mock;
  put: jest.Mock;
  mapping: { getExternalIds: jest.Mock; batchGetOrCreateInternalIds: jest.Mock };
} {
  const get = jest.fn();
  const put = jest.fn().mockResolvedValue({ status: 200, data: {} });
  const client = { get, put } as unknown as ShoperHttpClient;
  const mapping = {
    getExternalIds: jest.fn().mockResolvedValue([
      { externalId: '93', connectionId: CONNECTION_ID, platformType: 'shoper', entityType: 'Product' },
    ]),
    batchGetOrCreateInternalIds: jest.fn(
      (requests: Array<{ externalId: string; connectionId: string }>) =>
        Promise.resolve(
          new Map(requests.map((r) => [`${r.externalId}:${r.connectionId}`, `ol_${r.externalId}`])),
        ),
    ),
  };
  const adapter = new ShoperInventoryMasterAdapter(
    client,
    mapping as unknown as IdentifierMappingPort,
    { get: () => Promise.resolve(context) } as unknown as ShoperShopContextProvider,
    new ShoperProductReader(client, CONNECTION_ID),
    { id: CONNECTION_ID } as Connection,
  );
  return { adapter, get, put, mapping };
}

function shop(get: jest.Mock, stocks: unknown[], product: unknown = buildProduct()): void {
  get.mockImplementation((path: string) => {
    if (path === '/products/93') return Promise.resolve({ status: 200, data: product });
    if (path === '/product-stocks') return Promise.resolve({ status: 200, data: envelope(stocks) });
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
}

describe('ShoperInventoryMasterAdapter', () => {
  it('should list one pooled, location-less inventory per stock row', async () => {
    const { adapter, get } = setup();
    shop(get, [buildStock({ stock_id: '181', stock: '74' }), buildStock({ stock_id: '182', stock: '0' })]);

    const rows = await adapter.listInventory('ol_93');

    expect(rows).toEqual([
      expect.objectContaining({
        id: 'ol_stock:181',
        productId: 'ol_93',
        variantId: 'ol_181',
        locationId: undefined,
        quantity: 74,
        reserved: 0,
        available: 74,
      }),
      expect.objectContaining({ variantId: 'ol_182', quantity: 0, available: 0 }),
    ]);
  });

  it('should not probe the product while it still lists stock rows', async () => {
    const { adapter, get } = setup();
    shop(get, [buildStock()]);

    await adapter.listInventory('ol_93');

    const paths = (get.mock.calls as Array<[string]>).map(([path]) => path);
    expect(paths).not.toContain('/products/93');
  });

  it('should report a deleted product with the neutral not-found error when it has no stock rows', async () => {
    const { adapter, get } = setup();
    get.mockImplementation((path: string) =>
      path === '/products/93'
        ? Promise.reject(NOT_FOUND)
        : Promise.resolve({ status: 200, data: envelope([]) }),
    );

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should report a deletion when the stock listing itself answers Shoper’s 404 and the product is gone', async () => {
    const { adapter, get } = setup();
    get.mockRejectedValue(NOT_FOUND);

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should not read a 404 from the stock listing as a deletion while the product resolves', async () => {
    const { adapter, get } = setup();
    get.mockImplementation((path: string) =>
      path === '/products/93'
        ? Promise.resolve({ status: 200, data: buildProduct() })
        : Promise.reject(NOT_FOUND),
    );

    const error = await adapter.listInventory('ol_93').catch((e: unknown) => e);

    expect(error).toBe(NOT_FOUND);
    expect(error).not.toBeInstanceOf(MasterProductNotFoundError);
  });

  it('should keep a missing mapping platform-native, not a deletion', async () => {
    const { adapter, mapping } = setup();
    mapping.getExternalIds.mockResolvedValue([]);

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(ShoperNotMappedException);
  });

  it('should refuse a multi-warehouse shop before reading anything', async () => {
    const { adapter, get } = setup({ ...MAP_CONTEXT, warehousesEnabled: true });

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(
      ShoperWarehousesNotSupportedException,
    );
    expect(get).not.toHaveBeenCalled();
  });

  it('should fail on an unreadable stock level instead of reporting 0, minting no ids', async () => {
    const { adapter, get, mapping } = setup();
    shop(get, [buildStock({ stock_id: '181', stock: '5' }), buildStock({ stock_id: '182', stock: '' })]);

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(
      ShoperInvalidStockLevelException,
    );
    expect(mapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
  });

  it('should fail rather than return an inventory without an internal id', async () => {
    const { adapter, get, mapping } = setup();
    shop(get, [buildStock()]);
    mapping.batchGetOrCreateInternalIds.mockResolvedValue(new Map());

    await expect(adapter.listInventory('ol_93')).rejects.toThrow(/Missing internal id/);
  });

  it('should drop stock rows that belong to another product', async () => {
    const { adapter, get } = setup();
    shop(get, [buildStock({ stock_id: '181' }), buildStock({ stock_id: '999', product_id: '7' })]);

    await expect(adapter.listInventory('ol_93')).resolves.toHaveLength(1);
  });

  it('should return the first row from getInventory and its quantity from getAvailableQuantity', async () => {
    const { adapter, get } = setup();
    shop(get, [buildStock({ stock_id: '181', stock: '5' }), buildStock({ stock_id: '182', stock: '9' })]);

    await expect(adapter.getInventory('ol_93')).resolves.toMatchObject({ quantity: 5 });
    await expect(adapter.getAvailableQuantity('ol_93')).resolves.toBe(5);
  });

  // An empty list would make the sync stale every variant and pause its offers
  // (#1689) for a product that still exists, so it is an error from BOTH reads.
  it('should treat a resolving product with no stock rows as an inferred absence, never an empty list', async () => {
    const { adapter, get } = setup();
    shop(get, []);

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(ShoperStockNotFoundException);
    await expect(adapter.getInventory('ol_93')).rejects.toBeInstanceOf(ShoperStockNotFoundException);
  });

  describe('adjustInventory', () => {
    function withPut(stocks: unknown[]): ReturnType<typeof setup> & { put: jest.Mock } {
      const h = setup();
      shop(h.get, stocks);
      // A write is visible to the read-back, as on a real shop.
      h.put.mockImplementation((path: string, body: { stock: number }) => {
        const row = (stocks as Array<{ stock_id: string; stock: unknown }>).find(
          (r) => `/product-stocks/${r.stock_id}` === path,
        );
        if (row) row.stock = String(body.stock);
        return Promise.resolve({ status: 200, data: {} });
      });
      h.mapping.getExternalIds.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'ProductVariant'
            ? [{ externalId: '181', connectionId: CONNECTION_ID }]
            : [{ externalId: '93', connectionId: CONNECTION_ID }],
        ),
      );
      return h;
    }

    it('should write current plus delta as an absolute stock and report it unsupported-idempotent', async () => {
      const { adapter, put } = withPut([buildStock({ stock: '74' })]);

      const result = await adapter.adjustInventory({ productId: 'ol_93', quantity: 2 });

      expect(put).toHaveBeenCalledWith('/product-stocks/181', { stock: 76 });
      expect(result).toMatchObject({
        quantity: 76,
        available: 76,
        adjustmentOutcome: { disposition: 'applied', idempotency: 'unsupported', appliedAt: null },
      });
    });

    it('should report unsupported even when the caller sent an idempotency key', async () => {
      const { adapter } = withPut([buildStock({ stock: '1' })]);

      const result = await adapter.adjustInventory({
        productId: 'ol_93',
        quantity: 1,
        idempotencyKey: 'k',
      });

      expect(result.adjustmentOutcome?.idempotency).toBe('unsupported');
    });

    it('should clamp a decrease below zero to 0', async () => {
      const { adapter, put } = withPut([buildStock({ stock: '3' })]);

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: -10 })).resolves.toMatchObject({
        quantity: 0,
      });
      expect(put).toHaveBeenCalledWith('/product-stocks/181', { stock: 0 });
    });

    it('should target the named variant of a multi-variant product', async () => {
      const { adapter, put } = withPut([
        buildStock({ stock_id: '180', stock: '9' }),
        buildStock({ stock_id: '181', stock: '4' }),
      ]);

      await adapter.adjustInventory({ productId: 'ol_93', variantId: 'ol_181', quantity: 1 });

      expect(put).toHaveBeenCalledWith('/product-stocks/181', { stock: 5 });
    });

    it('should refuse to guess the variant when several exist and none is named', async () => {
      const { adapter, put } = withPut([buildStock({ stock_id: '180' }), buildStock({ stock_id: '181' })]);

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toBeInstanceOf(
        ShoperVariantRequiredException,
      );
      expect(put).not.toHaveBeenCalled();
    });

    it('should refuse a variantId that matches no stock row without writing', async () => {
      const { adapter, put, mapping } = withPut([buildStock({ stock_id: '180' })]);
      mapping.getExternalIds.mockImplementation((type: string) =>
        Promise.resolve([
          { externalId: type === 'ProductVariant' ? '999' : '93', connectionId: CONNECTION_ID },
        ]),
      );

      await expect(
        adapter.adjustInventory({ productId: 'ol_93', variantId: 'ol_999', quantity: 1 }),
      ).rejects.toBeInstanceOf(ShoperStockNotFoundException);
      expect(put).not.toHaveBeenCalled();
    });

    it('should not write when the stock level is unreadable', async () => {
      const { adapter, put } = withPut([buildStock({ stock: 'abc' })]);

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toBeInstanceOf(
        ShoperInvalidStockLevelException,
      );
      expect(put).not.toHaveBeenCalled();
    });

    it('should not write when identifier mapping fails', async () => {
      const { adapter, put, mapping } = withPut([buildStock({ stock: '3' })]);
      mapping.batchGetOrCreateInternalIds.mockRejectedValue(new Error('db down'));

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toThrow('db down');
      expect(put).not.toHaveBeenCalled();
    });

    it('should report the level Shoper holds after the write, not the computed one', async () => {
      const { adapter, get } = withPut([buildStock({ stock: '5' })]);
      let reads = 0;
      get.mockImplementation((path: string) => {
        if (path === '/products/93') return Promise.resolve({ status: 200, data: buildProduct() });
        reads += 1;
        return Promise.resolve({ status: 200, data: envelope([buildStock({ stock: reads === 1 ? '5' : '3' })]) });
      });

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: -1 })).resolves.toMatchObject({
        quantity: 3,
      });
    });

    it('should report the written level when the stock is unreadable after the write', async () => {
      const { adapter, get } = withPut([buildStock({ stock: '5' })]);
      let reads = 0;
      get.mockImplementation((path: string) => {
        if (path === '/products/93') return Promise.resolve({ status: 200, data: buildProduct() });
        reads += 1;
        return Promise.resolve({
          status: 200,
          data: envelope([buildStock({ stock: reads === 1 ? '5' : 'abc' })]),
        });
      });

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: -1 })).resolves.toMatchObject({
        quantity: 4,
      });
    });

    it('should report the written level when the read-back request fails', async () => {
      const { adapter, get } = withPut([buildStock({ stock: '5' })]);
      let reads = 0;
      get.mockImplementation((path: string) => {
        if (path === '/products/93') return Promise.resolve({ status: 200, data: buildProduct() });
        reads += 1;
        return reads === 1
          ? Promise.resolve({ status: 200, data: envelope([buildStock({ stock: '5' })]) })
          : Promise.reject(new ShoperNetworkError('boom'));
      });

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: -1 })).resolves.toMatchObject({
        quantity: 4,
      });
    });

    it('should refuse on a multi-warehouse shop without reading or writing', async () => {
      const h = setup({ ...MAP_CONTEXT, warehousesEnabled: true });

      await expect(h.adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toBeInstanceOf(
        ShoperWarehousesNotSupportedException,
      );
      expect(h.get).not.toHaveBeenCalled();
    });

    it('should not report success when the write fails', async () => {
      const { adapter, put } = withPut([buildStock({ stock: '3' })]);
      put.mockRejectedValue(new ShoperNetworkError('boom'));

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toBeInstanceOf(
        ShoperNetworkError,
      );
    });

    it('should not write when the product is gone', async () => {
      const { adapter, get, put } = withPut([]);
      get.mockRejectedValue(NOT_FOUND);

      await expect(adapter.adjustInventory({ productId: 'ol_93', quantity: 1 })).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
      expect(put).not.toHaveBeenCalled();
    });
  });

  it.each([
    [
      'reserveInventory',
      (a: ShoperInventoryMasterAdapter): Promise<unknown> => a.reserveInventory('p', 1, 'o'),
    ],
    [
      'releaseInventory',
      (a: ShoperInventoryMasterAdapter): Promise<unknown> => a.releaseInventory('p', 1, 'o'),
    ],
  ])('should reject %s as not supported', async (_name, call) => {
    await expect(call(setup().adapter)).rejects.toBeInstanceOf(ShoperNotSupportedException);
  });

  describe('prefetchInventory (BulkInventoryReader)', () => {
    interface ShopQuery {
      filters?: string;
      page?: number;
      'filters[product_id]'?: string;
    }

    interface InFilter {
      product_id: { in: number[] };
    }

    const singleRead = (id: string): unknown =>
      expect.objectContaining({ 'filters[product_id]': id });

    function stockOf(id: string, level = '5'): ReturnType<typeof buildStock> {
      return buildStock({ product_id: id, stock_id: `${id}0`, stock: level });
    }

    /** `existing` products with one stock row each; `rowless` exist but list no stock rows. */
    function bulkShop(
      get: jest.Mock,
      existing: readonly string[],
      rowless: readonly string[] = [],
    ): void {
      const has = new Set(existing);
      const products = new Set([...existing, ...rowless]);
      get.mockImplementation((path: string, query: ShopQuery = {}) => {
        if (path === '/product-stocks' && query.filters !== undefined) {
          const ids = (JSON.parse(query.filters) as { product_id: { in: number[] } }).product_id.in;
          const rows = ids.map(String).filter((id) => has.has(id)).map((id) => stockOf(id));
          const page = query.page ?? 1;
          const list = rows.slice((page - 1) * 50, page * 50);
          const pages = Math.max(1, Math.ceil(rows.length / 50));
          return Promise.resolve({ status: 200, data: envelope(list, { pages, page }) });
        }
        if (path === '/product-stocks') {
          const id = String(query['filters[product_id]']);
          const rows = has.has(id) ? [stockOf(id, '9')] : [];
          return Promise.resolve({ status: 200, data: envelope(rows) });
        }
        const single = /^\/products\/(\d+)$/.exec(path);
        if (single !== null) {
          const id = single[1] as string;
          return products.has(id)
            ? Promise.resolve({ status: 200, data: buildProduct({ product_id: id }) })
            : Promise.reject(NOT_FOUND);
        }
        return Promise.reject(new Error(`unexpected GET ${path}`));
      });
    }

    function mapEveryId(
      mapping: { getExternalIds: jest.Mock },
      unmapped: readonly string[] = [],
    ): void {
      mapping.getExternalIds.mockImplementation((_type: string, productId: string) =>
        Promise.resolve(
          unmapped.includes(productId)
            ? []
            : [
                {
                  externalId: productId.replace(/^ol_/, ''),
                  connectionId: CONNECTION_ID,
                  platformType: 'shoper',
                  entityType: 'Product',
                },
              ],
        ),
      );
    }

    const internal = (ids: readonly string[]): string[] => ids.map((id) => `ol_${id}`);
    const range = (n: number): string[] => Array.from({ length: n }, (_, i) => String(i + 1));

    it('should be offered through its guard, never through the manifest', () => {
      expect(isBulkInventoryReader(setup().adapter)).toBe(true);
    });

    it('should read 120 products’ stock in ceil(120/50) = 3 requests, then none per product', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping);
      const ids = range(120);
      bulkShop(get, ids);

      await adapter.prefetchInventory(internal(ids));

      expect(get).toHaveBeenCalledTimes(3);
      const chunks = (get.mock.calls as Array<[string, ShopQuery]>).map(
        ([, q]) => (JSON.parse(String(q.filters)) as InFilter).product_id.in.length,
      );
      expect(chunks).toEqual([50, 50, 20]);

      get.mockClear();
      for (const id of ids) {
        await expect(adapter.listInventory(`ol_${id}`)).resolves.toEqual([
          expect.objectContaining({ productId: `ol_${id}`, quantity: 5 }),
        ]);
      }
      expect(get).not.toHaveBeenCalled();
    });

    it('should still report a deletion from the shop’s own 404 for a product with no rows in the batch', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping);
      bulkShop(get, ['1']);

      await adapter.prefetchInventory(internal(['1', '2']));
      get.mockClear();

      await expect(adapter.listInventory('ol_2')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
      expect(get).toHaveBeenCalledWith('/products/2');
    });

    it('should still raise the inferred-absence error for a live product that lists no rows', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping);
      bulkShop(get, ['1'], ['2']);

      await adapter.prefetchInventory(internal(['1', '2']));

      await expect(adapter.listInventory('ol_2')).rejects.toBeInstanceOf(
        ShoperStockNotFoundException,
      );
    });

    it('should skip an unmapped id, leaving its own read to raise the mapping gap', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping, ['ol_2']);
      bulkShop(get, ['1', '2']);

      await adapter.prefetchInventory(internal(['1', '2']));

      const [, query] = get.mock.calls[0] as [string, ShopQuery];
      expect(JSON.parse(String(query.filters))).toEqual({ product_id: { in: [1] } });
      await expect(adapter.listInventory('ol_2')).rejects.toBeInstanceOf(ShoperNotMappedException);
    });

    it('should swallow a failed prefetch and fall back to the per-product read', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping);
      get.mockRejectedValueOnce(new ShoperNetworkError('ECONNRESET'));

      await expect(adapter.prefetchInventory(internal(['1']))).resolves.toBeUndefined();

      bulkShop(get, ['1']);
      get.mockClear();
      await expect(adapter.listInventory('ol_1')).resolves.toEqual([
        expect.objectContaining({ quantity: 9 }),
      ]);
      expect(get).toHaveBeenCalledWith('/product-stocks', singleRead('1'));
    });

    it('should seed nothing when the shop ignored the filter and answered with other products', async () => {
      const { adapter, get, mapping } = setup();
      mapEveryId(mapping);
      get.mockImplementationOnce(() =>
        Promise.resolve({ status: 200, data: envelope([stockOf('1'), stockOf('999')]) }),
      );

      await adapter.prefetchInventory(internal(['1']));

      bulkShop(get, ['1']);
      await expect(adapter.listInventory('ol_1')).resolves.toEqual([
        expect.objectContaining({ quantity: 9 }),
      ]);
    });

    it('should make no request on a multi-warehouse shop, whose reads are refused anyway', async () => {
      const { adapter, get, mapping } = setup({ ...MAP_CONTEXT, warehousesEnabled: true });
      mapEveryId(mapping);

      await adapter.prefetchInventory(internal(['1']));

      expect(get).not.toHaveBeenCalled();
    });

    it('should never adjust from the warm copy, and drop it for the product it wrote', async () => {
      const { adapter, get, put, mapping } = setup();
      mapEveryId(mapping);
      bulkShop(get, ['1']);
      await adapter.prefetchInventory(internal(['1']));
      get.mockClear();

      const result = await adapter.adjustInventory({ productId: 'ol_1', quantity: -2 });

      // The warm copy says 5; the shop says 9, and the write starts from the shop.
      expect(put).toHaveBeenCalledWith('/product-stocks/10', { stock: 7 });
      expect(result.quantity).toBe(9);
      get.mockClear();
      await adapter.listInventory('ol_1');
      expect(get).toHaveBeenCalledWith('/product-stocks', singleRead('1'));
    });
  });
});

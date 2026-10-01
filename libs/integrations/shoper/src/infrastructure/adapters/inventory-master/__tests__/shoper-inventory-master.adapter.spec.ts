import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperInvalidStockLevelException } from '../../../../domain/exceptions/shoper-invalid-stock-level.exception';
import { ShoperNotMappedException } from '../../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../../domain/exceptions/shoper-not-supported.exception';
import { ShoperStockNotFoundException } from '../../../../domain/exceptions/shoper-stock-not-found.exception';
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
  mapping: { getExternalIds: jest.Mock; batchGetOrCreateInternalIds: jest.Mock };
} {
  const get = jest.fn();
  const client = { get } as unknown as ShoperHttpClient;
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
  return { adapter, get, mapping };
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
      const put = jest.fn().mockResolvedValue({ status: 200, data: {} });
      (h.adapter as unknown as { client: { put: jest.Mock } }).client.put = put;
      shop(h.get, stocks);
      h.mapping.getExternalIds.mockImplementation((type: string) =>
        Promise.resolve(
          type === 'ProductVariant'
            ? [{ externalId: '181', connectionId: CONNECTION_ID }]
            : [{ externalId: '93', connectionId: CONNECTION_ID }],
        ),
      );
      return { ...h, put };
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
        ShoperStockNotFoundException,
      );
      expect(put).not.toHaveBeenCalled();
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
      get.mockRejectedValue(new ShoperApiError(404, '/products/93', 'invalid_request'));

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
});

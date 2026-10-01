import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { MasterProductNotFoundError } from '@openlinker/core/products';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
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

  it('should report a deleted product with the neutral not-found error', async () => {
    const { adapter, get } = setup();
    get.mockRejectedValue(new ShoperApiError(404, '/products/93', 'invalid_request'));

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(MasterProductNotFoundError);
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

  it('should fail on an unreadable stock level instead of reporting 0', async () => {
    const { adapter, get } = setup();
    shop(get, [buildStock({ stock: '' })]);

    await expect(adapter.listInventory('ol_93')).rejects.toBeInstanceOf(ShoperNetworkError);
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

  it('should treat a resolving product with no stock rows as an inferred absence', async () => {
    const { adapter, get } = setup();
    shop(get, []);

    await expect(adapter.listInventory('ol_93')).resolves.toEqual([]);
    await expect(adapter.getInventory('ol_93')).rejects.toBeInstanceOf(ShoperStockNotFoundException);
  });

  it.each([
    [
      'adjustInventory',
      (a: ShoperInventoryMasterAdapter): Promise<unknown> => a.adjustInventory({} as never),
    ],
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

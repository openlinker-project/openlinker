/**
 * Unit tests for PrestashopOrderStockEffectResolver
 *
 * PrestaShop lowers stock as `validateOrder` creates an order, unless the order
 * is created in `PS_OS_CANCELED` / `PS_OS_ERROR`; `PS_STOCK_MANAGEMENT` does
 * not gate it. These pin that the answer follows the state the order was
 * actually created in, refuses the product shapes it cannot vouch for, and
 * fails to `false` on anything it cannot read.
 */
import { PrestashopOrderStockEffectResolver } from '../prestashop-order-stock-effect.resolver';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';

interface Shop {
  histories?: Array<{ id: string; id_order_state: string }>;
  configurations?: Array<{ name: string; value: string }>;
  stockAvailables?: Array<{ id: string; depends_on_stock: string }>;
  packs?: Array<{ id: string }>;
  failOn?: string;
}

const DEFAULT_CONFIGURATIONS = [
  { name: 'PS_OS_CANCELED', value: '6' },
  { name: 'PS_OS_ERROR', value: '8' },
];

describe('PrestashopOrderStockEffectResolver', () => {
  let listResources: jest.Mock;

  function makeResolver(shop: Shop): PrestashopOrderStockEffectResolver {
    listResources = jest.fn((resource: string) => {
      if (resource === shop.failOn) {
        return Promise.reject(new Error(`${resource} read refused`));
      }
      switch (resource) {
        case 'order_histories':
          return Promise.resolve(shop.histories ?? [{ id: '10', id_order_state: '2' }]);
        case 'configurations':
          return Promise.resolve(shop.configurations ?? DEFAULT_CONFIGURATIONS);
        case 'stock_availables':
          return Promise.resolve(shop.stockAvailables ?? [{ id: '1', depends_on_stock: '0' }]);
        case 'products':
          return Promise.resolve(shop.packs ?? []);
        default:
          return Promise.resolve([]);
      }
    });
    const client = { listResources } as unknown as IPrestashopWebserviceClient;
    return new PrestashopOrderStockEffectResolver(client, 'conn-1');
  }

  it('should answer true when the order was created in a state that lowers stock', async () => {
    await expect(makeResolver({}).lowersStock('999', ['42'])).resolves.toBe(true);
  });

  it('should read the order histories of that order and the two skipping-state keys', async () => {
    await makeResolver({}).lowersStock('999', ['42']);

    expect(listResources).toHaveBeenCalledWith(
      'order_histories',
      expect.objectContaining({ custom: { id_order: '999' } }),
      expect.any(Number),
      expect.any(Number)
    );
    expect(listResources).toHaveBeenCalledWith(
      'configurations',
      expect.objectContaining({ custom: { name: ['PS_OS_CANCELED', 'PS_OS_ERROR'] } }),
      expect.any(Number),
      expect.any(Number)
    );
  });

  it.each([
    ['PS_OS_ERROR', '8'],
    ['PS_OS_CANCELED', '6'],
  ])('should answer false when the order was created in %s', async (_key, stateId) => {
    const resolver = makeResolver({ histories: [{ id: '10', id_order_state: stateId }] });

    await expect(resolver.lowersStock('999', ['42'])).resolves.toBe(false);
  });

  it('should judge by the FIRST history row, not a later state the order moved to', async () => {
    // validateOrder downgraded the order to Payment error (8), then a later
    // write moved it on: the lines were still created without lowering stock.
    const resolver = makeResolver({
      histories: [
        { id: '11', id_order_state: '2' },
        { id: '10', id_order_state: '8' },
      ],
    });

    await expect(resolver.lowersStock('999', ['42'])).resolves.toBe(false);
  });

  it('should answer false when the order has no readable history', async () => {
    await expect(makeResolver({ histories: [] }).lowersStock('999', ['42'])).resolves.toBe(false);
  });

  it('should answer false when a skipping-state key is not readable', async () => {
    const resolver = makeResolver({ configurations: [{ name: 'PS_OS_CANCELED', value: '6' }] });

    await expect(resolver.lowersStock('999', ['42'])).resolves.toBe(false);
  });

  it('should answer false for a legacy depends_on_stock product', async () => {
    const resolver = makeResolver({ stockAvailables: [{ id: '1', depends_on_stock: '1' }] });

    await expect(resolver.lowersStock('999', ['42'])).resolves.toBe(false);
  });

  it('should answer false when a line is a pack', async () => {
    await expect(makeResolver({ packs: [{ id: '42' }] }).lowersStock('999', ['42'])).resolves.toBe(
      false
    );
  });

  it('should answer false without reading when there are no product ids', async () => {
    const resolver = makeResolver({});

    await expect(resolver.lowersStock('999', [])).resolves.toBe(false);
    expect(listResources).not.toHaveBeenCalled();
  });

  it.each([['order_histories'], ['configurations'], ['stock_availables'], ['products']])(
    'should answer false when the %s read fails',
    async (failOn) => {
      await expect(makeResolver({ failOn }).lowersStock('999', ['42'])).resolves.toBe(false);
    }
  );

  it('should read the skipping-state keys once per instance', async () => {
    const resolver = makeResolver({});

    await resolver.lowersStock('999', ['42']);
    await resolver.lowersStock('1000', ['42']);

    const configurationReads = listResources.mock.calls.filter(
      ([resource]) => resource === 'configurations'
    );
    expect(configurationReads).toHaveLength(1);
  });
});

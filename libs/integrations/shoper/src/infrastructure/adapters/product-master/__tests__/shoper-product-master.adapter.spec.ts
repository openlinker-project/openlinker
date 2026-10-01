import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

import { ShoperNotMappedException } from '../../../../domain/exceptions/shoper-not-mapped.exception';
import { ShoperNotSupportedException } from '../../../../domain/exceptions/shoper-not-supported.exception';
import {
  MAP_CONTEXT,
  buildProduct,
  buildStock,
  envelope,
} from '../../../__tests__/shoper-test-data';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { ShoperProductMasterAdapter } from '../shoper-product-master.adapter';

const CONNECTION_ID = 'conn-1';

interface Harness {
  adapter: ShoperProductMasterAdapter;
  get: jest.Mock;
  mapping: {
    getExternalIds: jest.Mock;
    batchGetOrCreateInternalIds: jest.Mock;
  };
}

function setup(): Harness {
  const get = jest.fn();
  const mapping = {
    getExternalIds: jest.fn().mockResolvedValue([
      { externalId: '93', connectionId: CONNECTION_ID, platformType: 'shoper', entityType: 'Product' },
    ]),
    // Internal id = "ol_" + external id, keyed the way the real service keys its map.
    batchGetOrCreateInternalIds: jest.fn(
      (requests: Array<{ externalId: string; connectionId: string }>) =>
        Promise.resolve(
          new Map(requests.map((r) => [`${r.externalId}:${r.connectionId}`, `ol_${r.externalId}`])),
        ),
    ),
  };
  const adapter = new ShoperProductMasterAdapter(
    { get } as unknown as ShoperHttpClient,
    mapping as unknown as IdentifierMappingPort,
    { get: () => Promise.resolve(MAP_CONTEXT) } as unknown as ShoperShopContextProvider,
    { id: CONNECTION_ID } as Connection,
  );
  return { adapter, get, mapping };
}

function respond(get: jest.Mock, routes: Record<string, unknown>): void {
  get.mockImplementation((path: string) => {
    if (!(path in routes)) {
      return Promise.reject(new Error(`unexpected GET ${path}`));
    }
    return Promise.resolve({ status: 200, data: routes[path] });
  });
}

/**
 * A fake shop of `total` products that behaves like the live one where it
 * matters: pages by index and SILENTLY shrinks a `limit` above 50 to 10.
 */
function fakeShop(total: number, get: jest.Mock): void {
  get.mockImplementation((_path: string, query: { page: number; limit: number }) => {
    const effective = query.limit > 50 ? 10 : query.limit;
    const all = Array.from({ length: total }, (_, i) => ({ product_id: String(i + 1) }));
    const start = (query.page - 1) * effective;
    return Promise.resolve({
      status: 200,
      data: envelope(all.slice(start, start + effective), {
        count: total,
        pages: Math.max(1, Math.ceil(total / effective)),
        page: query.page,
      }),
    });
  });
}

function idsFrom(first: number, last: number): string[] {
  return Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
}

function pagesRequested(get: jest.Mock): number[] {
  return get.mock.calls.map(([, query]) => (query as { page: number }).page);
}

describe('ShoperProductMasterAdapter', () => {
  describe('listExternalIds', () => {
    it('should return Shoper product ids, ascending, from page 1 by default', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([{ product_id: '93' }, { product_id: '94' }]) });

      await expect(adapter.listExternalIds()).resolves.toEqual(['93', '94']);

      expect(get).toHaveBeenCalledWith('/products', {
        order: 'product_id ASC',
        limit: 50,
        page: 1,
      });
    });

    it('should serve a 100-row window (the sweep default) from two pages of 50', async () => {
      const { adapter, get } = setup();
      fakeShop(400, get);

      const ids = await adapter.listExternalIds({ limit: 100, offset: 0 });

      expect(ids).toEqual(idsFrom(1, 100));
      expect(pagesRequested(get)).toEqual([1, 2]);
    });

    it('should serve a window at an offset that is not a multiple of anything', async () => {
      const { adapter, get } = setup();
      fakeShop(400, get);

      const ids = await adapter.listExternalIds({ limit: 100, offset: 130 });

      expect(ids).toEqual(idsFrom(131, 230));
      expect(pagesRequested(get)).toEqual([3, 4, 5]);
    });

    it('should serve the largest sweep window (500) in ten requests', async () => {
      const { adapter, get } = setup();
      fakeShop(2000, get);

      const ids = await adapter.listExternalIds({ limit: 500, offset: 500 });

      expect(ids).toEqual(idsFrom(501, 1000));
      expect(get).toHaveBeenCalledTimes(10);
    });

    it('should never ask Shoper for a page above its ceiling of 50, which it would silently shrink', async () => {
      const { adapter, get } = setup();
      fakeShop(400, get);

      await adapter.listExternalIds({ limit: 500, offset: 0 });
      await adapter.listExternalIds({ limit: 7, offset: 3 });

      const limits = get.mock.calls.map(([, query]) => (query as { limit: number }).limit);
      expect(Math.max(...limits)).toBe(50);
    });

    it('should keep a cursor intact when the sweep page size changes mid-cycle (100 -> 30)', async () => {
      const { adapter, get } = setup();
      fakeShop(400, get);

      const cycle = [
        ...(await adapter.listExternalIds({ limit: 100, offset: 0 })),
        ...(await adapter.listExternalIds({ limit: 30, offset: 100 })),
        ...(await adapter.listExternalIds({ limit: 30, offset: 130 })),
        ...(await adapter.listExternalIds({ limit: 270, offset: 160 })),
      ];

      // 100 + 30 + 30 + a 270 window that runs past the end of a 400-row shop:
      // every row exactly once, in order, none skipped at the seams.
      expect(cycle).toEqual(idsFrom(1, 400));
    });

    it('should stop on the shop’s own last page, not on a short page of its own making', async () => {
      const { adapter, get } = setup();
      fakeShop(36, get);

      const ids = await adapter.listExternalIds({ limit: 100, offset: 0 });

      expect(ids).toEqual(idsFrom(1, 36));
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('should return an empty window past the end instead of looping', async () => {
      const { adapter, get } = setup();
      fakeShop(36, get);

      await expect(adapter.listExternalIds({ limit: 100, offset: 500 })).resolves.toEqual([]);
    });

    it.each([
      ['a window above the sanity bound', { limit: 1001, offset: 0 }],
      ['a zero window', { limit: 0, offset: 0 }],
      ['a negative offset', { limit: 10, offset: -1 }],
      ['a fractional offset', { limit: 10, offset: 1.5 }],
    ])('should reject %s without calling Shoper', async (_label, window) => {
      const { adapter, get } = setup();

      await expect(adapter.listExternalIds(window)).rejects.toThrow(RangeError);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getProduct', () => {
    it('should resolve the Shoper id from the mapping and return the product under its internal id', async () => {
      const { adapter, get, mapping } = setup();
      respond(get, { '/products/93': buildProduct() });

      const product = await adapter.getProduct('ol_product_1');

      expect(mapping.getExternalIds).toHaveBeenCalledWith('Product', 'ol_product_1');
      expect(product).toMatchObject({
        id: 'ol_product_1',
        name: 'Ceramiczny zestaw naczyń Sandstone Freckless',
        sku: '3505-4890F',
        price: 1484.28,
        currency: 'PLN',
      });
    });

    it('should raise a platform-native mapping error, not the neutral not-found, when there is no mapping here', async () => {
      const { adapter, get, mapping } = setup();
      mapping.getExternalIds.mockResolvedValue([
        { externalId: '93', connectionId: 'another-connection' },
      ]);

      await expect(adapter.getProduct('ol_product_1')).rejects.toBeInstanceOf(
        ShoperNotMappedException,
      );
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getProducts', () => {
    it('should map a page of products to internal ids with one batched mapping call', async () => {
      const { adapter, get, mapping } = setup();
      respond(get, {
        '/products': envelope([
          buildProduct({ product_id: '93' }),
          buildProduct({ product_id: '94', code: 'B' }),
        ]),
      });

      const products = await adapter.getProducts({ limit: 2 });

      expect(products.map((p) => p.id)).toEqual(['ol_93', 'ol_94']);
      expect(mapping.batchGetOrCreateInternalIds).toHaveBeenCalledTimes(1);
    });

    it('should skip a product the mapping service returned no id for', async () => {
      const { adapter, get, mapping } = setup();
      respond(get, { '/products': envelope([buildProduct({ product_id: '93' })]) });
      mapping.batchGetOrCreateInternalIds.mockResolvedValue(new Map());

      await expect(adapter.getProducts()).resolves.toEqual([]);
    });

    it('should fetch a requested id set with a single JSON "in" filter', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([buildProduct()]) });

      await adapter.getProducts({ externalIds: ['93', '94'] });

      const [, request] = get.mock.calls[0] as [string, { filters: string }];
      expect(JSON.parse(request.filters)).toEqual({ product_id: { in: [93, 94] } });
    });

    it('should serve a window larger than one Shoper page from several pages', async () => {
      const { adapter, get } = setup();
      get.mockImplementation((_path: string, query: { page: number; limit: number }) =>
        Promise.resolve({
          status: 200,
          data: envelope(
            Array.from({ length: 50 }, (_, i) =>
              buildProduct({ product_id: String((query.page - 1) * 50 + i + 1) }),
            ),
            { count: 200, pages: 4, page: query.page },
          ),
        }),
      );

      const products = await adapter.getProducts({ limit: 80, offset: 10 });

      expect(products).toHaveLength(80);
      expect(products[0].id).toBe('ol_11');
      expect(products[79].id).toBe('ol_90');
    });

    it('should skip a non-numeric id instead of sending NaN in the filter', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([buildProduct()]) });

      await adapter.getProducts({ externalIds: ['93', 'abc', '9 3', ''] });

      const [, request] = get.mock.calls[0] as [string, { filters: string }];
      expect(JSON.parse(request.filters)).toEqual({ product_id: { in: [93] } });
    });

    it('should not call Shoper at all when no requested id is numeric', async () => {
      const { adapter, get } = setup();

      await expect(adapter.getProducts({ externalIds: ['abc'] })).resolves.toEqual([]);
      expect(get).not.toHaveBeenCalled();
    });

    it('should leave an id Shoper did not return out of the result, not report it as deleted', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([buildProduct({ product_id: '93' })]) });

      const products = await adapter.getProducts({ externalIds: ['93', '999'] });

      expect(products.map((p) => p.id)).toEqual(['ol_93']);
    });

    it('should chunk a requested id set larger than one page', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([]) });
      const ids = Array.from({ length: 120 }, (_, i) => String(i + 1));

      await adapter.getProducts({ externalIds: ids });

      expect(get).toHaveBeenCalledTimes(3);
    });

    it('should turn a text query into a name LIKE filter', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products': envelope([]) });

      await adapter.searchProducts('zestaw');

      const [, request] = get.mock.calls[0] as [string, { filters: string }];
      expect(JSON.parse(request.filters)).toEqual({ 'translations.name': { like: '%zestaw%' } });
    });

    it.each([
      ['categoryIds', { categoryIds: ['38'] }],
      ['status', { status: 'active' }],
    ])('should refuse the unsupported filter %s instead of ignoring it', async (_name, filters) => {
      const { adapter, get } = setup();

      await expect(adapter.getProducts(filters)).rejects.toBeInstanceOf(ShoperNotSupportedException);
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('getProductVariants', () => {
    it('should return one variant per product-stocks row, keyed by stock_id', async () => {
      const { adapter, get, mapping } = setup();
      respond(get, {
        '/product-stocks': envelope([
          buildStock({ stock_id: '300', code: 'S' }),
          buildStock({ stock_id: '301', code: 'M' }),
        ]),
      });

      const variants = await adapter.getProductVariants('ol_product_1');

      expect(variants.map((v) => [v.id, v.sku, v.productId])).toEqual([
        ['ol_300', 'S', 'ol_product_1'],
        ['ol_301', 'M', 'ol_product_1'],
      ]);
      expect(get).toHaveBeenCalledWith(
        '/product-stocks',
        expect.objectContaining({ 'filters[product_id]': '93' }),
      );
      expect(mapping.batchGetOrCreateInternalIds).toHaveBeenCalledWith([
        expect.objectContaining({ entityType: 'ProductVariant', externalId: '300' }),
        expect.objectContaining({ entityType: 'ProductVariant', externalId: '301' }),
      ]);
    });

    it('should drop stock rows of another product if Shoper stops honouring the product filter', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/product-stocks': envelope([
          buildStock({ stock_id: '181', product_id: '93' }),
          buildStock({ stock_id: '182', product_id: '94' }),
          buildStock({ stock_id: '183', product_id: '95' }),
        ]),
      });

      const variants = await adapter.getProductVariants('ol_product_1');

      expect(variants.map((v) => v.id)).toEqual(['ol_181']);
      expect(variants.every((v) => v.productId === 'ol_product_1')).toBe(true);
    });

    it('should not mint a synthetic variant for a simple product', async () => {
      const { adapter, get } = setup();
      respond(get, { '/product-stocks': envelope([buildStock()]) });

      const variants = await adapter.getProductVariants('ol_product_1');

      expect(variants).toHaveLength(1);
      expect(variants[0].id).toBe('ol_181');
    });

    it('should read every page when a product has more variants than one page holds', async () => {
      const { adapter, get } = setup();
      get
        .mockResolvedValueOnce({
          status: 200,
          data: envelope([buildStock({ stock_id: '1' })], { count: 2, pages: 2, page: 1 }),
        })
        .mockResolvedValueOnce({
          status: 200,
          data: envelope([buildStock({ stock_id: '2' })], { count: 2, pages: 2, page: 2 }),
        });

      const variants = await adapter.getProductVariants('ol_product_1');

      expect(variants.map((v) => v.id)).toEqual(['ol_1', 'ol_2']);
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('should return no variants for a product with no stock rows', async () => {
      const { adapter, get, mapping } = setup();
      respond(get, { '/product-stocks': envelope([]) });

      await expect(adapter.getProductVariants('ol_product_1')).resolves.toEqual([]);
      expect(mapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });
  });

  describe('methods outside this milestone', () => {
    type Call = (adapter: ShoperProductMasterAdapter) => Promise<unknown>;
    const cases: Array<[string, Call]> = [
      ['createProduct', (a): Promise<unknown> => a.createProduct({ name: 'n', sku: 's', price: 1 })],
      ['updateProduct', (a): Promise<unknown> => a.updateProduct('p', {})],
      ['deleteProduct', (a): Promise<unknown> => a.deleteProduct('p')],
      ['upsertProductVariant', (a): Promise<unknown> => a.upsertProductVariant('p', { sku: 's' })],
      ['getProductCategories', (a): Promise<unknown> => a.getProductCategories('p')],
      ['assignCategories', (a): Promise<unknown> => a.assignCategories('p', [])],
    ];

    it.each(cases)('should reject %s as not supported', async (name, call) => {
      const { adapter } = setup();

      const error = await call(adapter).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ShoperNotSupportedException);
      expect((error as ShoperNotSupportedException).operation).toBe(name);
    });
  });
});

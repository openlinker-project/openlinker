import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
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
import type { ShoperTaxTableProvider } from '../../../shop-context/shoper-tax-table.provider';
import { isProductTaxRateReader } from '@openlinker/core/products';
import { ShoperProductMasterAdapter } from '../shoper-product-master.adapter';

const CONNECTION_ID = 'conn-1';

interface Harness {
  adapter: ShoperProductMasterAdapter;
  get: jest.Mock;
  mapping: {
    getExternalIds: jest.Mock;
    batchGetOrCreateInternalIds: jest.Mock;
  };
  taxTable: { get: jest.Mock };
}

/** The live trial shop's /taxes table. */
const TAX_TABLE = new Map(
  [
    ['1', '23', '23%'],
    ['2', '8', '8%'],
    ['3', '0', '0%'],
    ['4', '0', 'zw.'],
    ['5', '0', 'np.'],
    ['6', '5', '5%'],
    ['9', '7', 'stawka specjalna'],
    // Hand-edited / corrupted rows: the label and the value contradict each other.
    ['10', '8', '23%'],
    ['11', '23', 'zw.'],
  ].map(([tax_id, value, name]) => [tax_id, { tax_id, value, name }]),
);

function setup(): Harness {
  const get = jest.fn();
  const taxTable = { get: jest.fn().mockResolvedValue(TAX_TABLE) };
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
    taxTable as unknown as ShoperTaxTableProvider,
    { id: CONNECTION_ID } as Connection,
  );
  return { adapter, get, mapping, taxTable };
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

  describe('readProductTaxRate', () => {
    it('should be discoverable through the core guard', () => {
      expect(isProductTaxRateReader(setup().adapter)).toBe(true);
    });

    it.each([
      ['1', '23'],
      ['2', '8'],
      ['6', '5'],
      ['3', '0'],
      ['4', 'zw'],
      ['5', 'np'],
    ])('should resolve tax_id %p to code %p', async (taxId, code) => {
      const { adapter, get } = setup();
      respond(get, { '/products/93': buildProduct({ tax_id: taxId }) });

      await expect(adapter.readProductTaxRate({ productId: 'ol_product_1' })).resolves.toEqual({
        kind: 'resolved',
        code,
        countryIso2: null,
      });
    });

    it.each([[null], [''], ['0']])(
      'should report a product with tax_id %p as not configured, never a fallback rate',
      async (taxId) => {
        const { adapter, get, taxTable } = setup();
        respond(get, { '/products/93': buildProduct({ tax_id: taxId }) });

        await expect(adapter.readProductTaxRate({ productId: 'ol_product_1' })).resolves.toMatchObject({
          kind: 'unknown',
          reason: 'not-configured',
        });
        expect(taxTable.get).not.toHaveBeenCalled();
      },
    );

    it('should report a tax_id missing from the table as unreadable', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products/93': buildProduct({ tax_id: '42' }) });

      await expect(adapter.readProductTaxRate({ productId: 'ol_product_1' })).resolves.toMatchObject({
        kind: 'unknown',
        reason: 'unreadable',
      });
    });

    it('should report an unrecognised rate name as unreadable, naming it', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products/93': buildProduct({ tax_id: '9' }) });

      const result = await adapter.readProductTaxRate({ productId: 'ol_product_1' });

      expect(result).toMatchObject({ kind: 'unknown', reason: 'unreadable' });
      expect(result.kind === 'unknown' && result.detail).toContain('stawka specjalna');
    });

    it.each([
      ['10', '23%', 'carries value 8'],
      ['11', 'zw.', 'carries value 23'],
    ])(
      'should refuse tax_id %p ("%s") whose name contradicts its value, rather than feed a fiscal document',
      async (taxId, name, detail) => {
        const { adapter, get } = setup();
        respond(get, { '/products/93': buildProduct({ tax_id: taxId }) });

        const result = await adapter.readProductTaxRate({ productId: 'ol_product_1' });

        expect(result).toMatchObject({ kind: 'unknown', reason: 'unreadable' });
        expect(result.kind === 'unknown' && result.detail).toContain(detail);
        expect(result.kind === 'unknown' && result.detail).toContain(name);
      },
    );

    it('should let a transport failure propagate instead of turning it into an answer', async () => {
      const { adapter, get, taxTable } = setup();
      respond(get, { '/products/93': buildProduct() });
      taxTable.get.mockRejectedValue(new Error('taxes 500'));

      await expect(adapter.readProductTaxRate({ productId: 'ol_product_1' })).rejects.toThrow(
        'taxes 500',
      );
    });

    it('should share the product read with getProduct and getProductCategories', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/products/93': buildProduct({ categories: [] }),
        '/categories-tree': [],
        '/categories': envelope([]),
      });

      await adapter.getProduct('ol_product_1');
      await adapter.getProductCategories('ol_product_1');
      await adapter.readProductTaxRate({ productId: 'ol_product_1' });

      expect(get.mock.calls.filter(([path]) => path === '/products/93')).toHaveLength(1);
    });

    it('should read the product, not the variant, since tax lives on the product', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products/93': buildProduct() });

      await adapter.readProductTaxRate({ productId: 'ol_product_1', variantId: 'ol_variant_1' });

      expect(adapter.readsTaxRatePerVariant()).toBe(false);
      expect(get).toHaveBeenCalledTimes(1);
      expect(get).toHaveBeenCalledWith('/products/93');
    });
  });

  describe('categories', () => {
    const tree = [{ id: 45, children: [{ id: 38, children: [] }, { id: 39, children: [] }] }];
    const list = envelope([
      { category_id: '45', translations: { pl_PL: { name: 'Kolekcje', active: '1' } } },
      { category_id: '38', translations: { pl_PL: { name: 'Zestawy', active: '1' } } },
      { category_id: '39', translations: { pl_PL: { name: 'Talerze', active: '0' } } },
    ]);

    it('should return the directory joined from the tree and the paged list', async () => {
      const { adapter, get } = setup();
      respond(get, { '/categories-tree': tree, '/categories': list });

      await expect(adapter.getCategories()).resolves.toEqual([
        { id: '45', name: 'Kolekcje', depth: 0, active: true },
        { id: '38', name: 'Zestawy', parentId: '45', depth: 1, active: true },
        { id: '39', name: 'Talerze', parentId: '45', depth: 1, active: false },
      ]);
      expect(get).toHaveBeenCalledWith(
        '/categories',
        expect.objectContaining({ order: 'category_id ASC', limit: 50, page: 1 }),
      );
    });

    it('should read every page of the category list', async () => {
      const { adapter, get } = setup();
      get.mockImplementation((path: string, query?: { page?: number }) => {
        if (path === '/categories-tree') return Promise.resolve({ status: 200, data: [] });
        const page = query?.page ?? 1;
        return Promise.resolve({
          status: 200,
          data: envelope(
            [{ category_id: String(page), translations: { pl_PL: { name: `C${page}` } } }],
            { pages: 2, page },
          ),
        });
      });

      const categories = await adapter.getCategories();

      expect(categories.map((c) => c.id)).toEqual(['1', '2']);
    });

    it('should build the directory ONCE per adapter instance, however many products ask', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/products/93': buildProduct({ categories: [38] }),
        '/categories-tree': tree,
        '/categories': list,
      });

      await adapter.getProductCategories('ol_product_1');
      await adapter.getProductCategories('ol_product_1');
      await adapter.getCategories();
      await adapter.getCategories();

      const calls = get.mock.calls.map(([path]) => path as string);
      expect(calls.filter((p) => p === '/categories-tree')).toHaveLength(1);
      expect(calls.filter((p) => p === '/categories')).toHaveLength(1);
    });

    it('should share the directory between concurrent callers', async () => {
      const { adapter, get } = setup();
      respond(get, { '/categories-tree': tree, '/categories': list });

      await Promise.all([adapter.getCategories(), adapter.getCategories(), adapter.getCategories()]);

      expect(get.mock.calls.filter(([path]) => path === '/categories-tree')).toHaveLength(1);
    });

    it('should hand each caller its own array, so one cannot corrupt the shared directory', async () => {
      const { adapter, get } = setup();
      respond(get, { '/categories-tree': tree, '/categories': list });

      const first = await adapter.getCategories();
      first.length = 0;

      await expect(adapter.getCategories()).resolves.toHaveLength(3);
    });

    it('should not keep a failed directory build: the next call retries', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValueOnce(new Error('tree 500'));
      get.mockImplementation((path: string) =>
        Promise.resolve({ status: 200, data: path === '/categories-tree' ? tree : list }),
      );

      await expect(adapter.getCategories()).rejects.toThrow();
      await expect(adapter.getCategories()).resolves.toHaveLength(3);
    });

    it.each([
      ['an object', {}],
      ['a string', 'oops'],
      ['null', null],
    ])('should throw on an unreadable category tree (%s) instead of returning unplaced roots', async (_l, bad) => {
      const { adapter, get } = setup();
      respond(get, { '/categories-tree': bad, '/categories': list });

      await expect(adapter.getCategories()).rejects.toBeInstanceOf(ShoperNetworkError);
    });

    it('should accept a legitimately empty tree', async () => {
      const { adapter, get } = setup();
      respond(get, { '/categories-tree': [], '/categories': list });

      const categories = await adapter.getCategories();

      expect(categories.every((c) => c.parentId === undefined && c.depth === undefined)).toBe(true);
    });

    it('should read the product ONCE when getProduct and getProductCategories both ask', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/products/93': buildProduct({ categories: [38] }),
        '/categories-tree': tree,
        '/categories': list,
      });

      await adapter.getProduct('ol_product_1');
      await adapter.getProductCategories('ol_product_1');

      expect(get.mock.calls.filter(([path]) => path === '/products/93')).toHaveLength(1);
    });

    it('should not keep a failed product read: the next call retries', async () => {
      const { adapter, get } = setup();
      get.mockRejectedValueOnce(new Error('product 500'));
      respond(get, { '/products/93': buildProduct({ categories: [] }) });

      await expect(adapter.getProductCategories('ol_product_1')).rejects.toThrow('product 500');
      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([]);
    });

    it('should resolve a product category ids through the directory', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/products/93': buildProduct({ categories: [39, 38] }),
        '/categories-tree': tree,
        '/categories': list,
      });

      const categories = await adapter.getProductCategories('ol_product_1');

      expect(categories.map((c) => c.name)).toEqual(['Talerze', 'Zestawy']);
    });

    it('should skip an id absent from the directory instead of throwing', async () => {
      const { adapter, get } = setup();
      respond(get, {
        '/products/93': buildProduct({ categories: [38, 777] }),
        '/categories-tree': tree,
        '/categories': list,
      });

      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([
        expect.objectContaining({ id: '38' }),
      ]);
    });

    it('should return [] for a product with no categories without reading the directory', async () => {
      const { adapter, get } = setup();
      respond(get, { '/products/93': buildProduct({ categories: [] }) });

      await expect(adapter.getProductCategories('ol_product_1')).resolves.toEqual([]);
      expect(get).toHaveBeenCalledTimes(1);
    });
  });

  describe('methods outside this milestone', () => {
    type Call = (adapter: ShoperProductMasterAdapter) => Promise<unknown>;
    const cases: Array<[string, Call]> = [
      ['createProduct', (a): Promise<unknown> => a.createProduct({ name: 'n', sku: 's', price: 1 })],
      ['updateProduct', (a): Promise<unknown> => a.updateProduct('p', {})],
      ['deleteProduct', (a): Promise<unknown> => a.deleteProduct('p')],
      ['upsertProductVariant', (a): Promise<unknown> => a.upsertProductVariant('p', { sku: 's' })],
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

/**
 * WooCommerce Product Master Adapter — unit tests
 *
 * Mocks IWooCommerceHttpClient (interface) and IdentifierMappingPort.
 * Covers all read methods (#874) and write methods (#879).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-master/__tests__
 */
import { WooCommerceProductMasterAdapter } from '../woocommerce-product-master.adapter';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { IWooCommerceProductMapper } from '../../../mappers/woocommerce-product.mapper.interface';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import { WooCommerceDuplicateSkuException } from '../../../../domain/exceptions/woocommerce-duplicate-sku.exception';
import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import type {
  WooCommerceGeneralSetting,
  WooCommerceProduct,
  WooCommerceProductVariation,
  WooCommerceTaxRate,
} from '../woocommerce-product.types';
import { WooCommerceProductMapper } from '../../../mappers/woocommerce-product.mapper';

const CONNECTION_ID = 'conn-001';

const mockConnection: Connection = {
  id: CONNECTION_ID,
  platformType: 'woocommerce',
  name: 'Test WC Store',
  status: 'active',
  config: { siteUrl: 'https://myshop.com' } as Record<string, unknown>,
  credentialsRef: 'cred-ref-001',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['ProductMaster'],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  };
}

function makeIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  // SECURITY WARNING: These are test fixtures only, never use hardcoded credentials in production.
  // Use environment variables or secure credential storage instead.
  return {
    getOrCreateInternalId: jest.fn(),
    getOrCreateExactMapping: jest.fn(),
    getInternalId: jest.fn(),
    getExternalIds: jest.fn(),
    createMapping: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    deleteMapping: jest.fn(),
    listExternalIdsByConnection: jest.fn(),
  };
}

function makeMapper(): jest.Mocked<IWooCommerceProductMapper> {
  return {
    mapProduct: jest.fn().mockReturnValue({
      name: 'Product',
      sku: 'SKU-1',
      price: 10,
      currency: null,
      description: null,
      images: null,
      categories: [],
      weight: undefined,
    }),
    mapVariation: jest.fn().mockReturnValue({
      productId: 'prod-internal-1',
      sku: 'VAR-1',
      price: 5,
      attributes: null,
      ean: null,
      gtin: null,
    }),
  };
}

/**
 * Answers every `/settings/*` read with an empty row list (a store that does
 * not calculate taxes, so no price-basis conversion) and every other read with
 * `product`.
 */
function routeSettingsAndProduct(
  httpClient: jest.Mocked<IWooCommerceHttpClient>,
  product: WooCommerceProduct,
): void {
  httpClient.get.mockImplementation((path: string) => {
    if (path.startsWith('/wp-json/wc/v3/settings/')) return Promise.resolve([]);
    return Promise.resolve(product);
  });
}

function makeAdapter(
  httpClient: jest.Mocked<IWooCommerceHttpClient>,
  identifierMapping: jest.Mocked<IdentifierMappingPort>,
  mapper: jest.Mocked<IWooCommerceProductMapper>,
): WooCommerceProductMasterAdapter {
  return new WooCommerceProductMasterAdapter(
    httpClient,
    identifierMapping,
    mapper,
    mockConnection,
  );
}

describe('WooCommerceProductMasterAdapter', () => {
  describe('listExternalIds', () => {
    it('should return string IDs from API response', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.listExternalIds({ limit: 100, offset: 0 });
      expect(result).toEqual(['1', '2', '3']);
    });

    it('should filter out objects with undefined id', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 1 }, { id: undefined }, { id: 3 }]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.listExternalIds();
      expect(result).toEqual(['1', '3']);
    });

    // WooCommerce's REST layer caps `per_page` at 100 on every list endpoint.
    // This is a real platform wall, unlike the advisory ceilings in
    // OPERATIONAL_SETTING_BOUNDS, so it is enforced where the request is built
    // — the only place that knows WooCommerce is the adapter about to send it.
    //
    // It REFUSES rather than clamping (#2660 review): this method feeds the
    // worker's `readPagedIds`, which treats a page shorter than the REQUESTED
    // size as the end of the collection. A clamped page is always short, so
    // clamping made every sweep cycle "complete" after 100 products and sweep
    // the same 100 on every tick for ever, behind one warn line.
    it('should refuse a page size above the WooCommerce maximum of 100', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await expect(adapter.listExternalIds({ limit: 250, offset: 0 })).rejects.toThrow(
        /100/,
      );
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should name the offending value so the refusal says what to change', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await expect(adapter.listExternalIds({ limit: 250, offset: 0 })).rejects.toThrow(
        /250/,
      );
    });

    it('should send a page size the platform accepts unchanged', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await adapter.listExternalIds({ limit: 100, offset: 0 });

      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ per_page: 100 }),
      );
    });

    it('should translate offset to page correctly (offset=100, limit=100 → page=2)', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await adapter.listExternalIds({ limit: 100, offset: 100 });
      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ page: 2, per_page: 100 }),
      );
    });
  });

  describe('listExternalIdsModifiedSince (#2220 modified-since rung)', () => {
    const SINCE = new Date('2026-08-20T09:55:00.000Z');

    it('should pass dates_are_gmt=true so the window is not compared against site-local time', async () => {
      // The single most important literal in this rung. WooCommerce defaults this
      // to false and then compares `modified_after` against the SITE's timezone, so
      // without it products modified inside the local-offset window are silently
      // skipped once the watermark moves past them. Same flag, same reason, as the
      // order source adapter.
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await adapter.listExternalIdsModifiedSince({ since: SINCE, limit: 100, offset: 0 });

      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ dates_are_gmt: true }),
      );
    });

    it('should send the watermark as an ISO instant and order by modified ascending', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await adapter.listExternalIdsModifiedSince({ since: SINCE, limit: 100, offset: 0 });

      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({
          modified_after: '2026-08-20T09:55:00.000Z',
          orderby: 'modified',
          order: 'asc',
          _fields: 'id',
        }),
      );
    });

    it('should translate offset to page the same way listExternalIds does', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      await adapter.listExternalIdsModifiedSince({ since: SINCE, limit: 100, offset: 200 });

      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ page: 3, per_page: 100 }),
      );
    });

    it('should return string IDs and drop rows with no id', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 7 }, { id: undefined }, { id: 9 }]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());

      const result = await adapter.listExternalIdsModifiedSince({
        since: SINCE,
        limit: 100,
        offset: 0,
      });

      expect(result).toEqual(['7', '9']);
    });
  });

  describe('getProduct', () => {
    it('should return product with internal ID', async () => {
      const httpClient = makeHttpClient();
      // Path-aware: a bare `mockResolvedValue` would answer the currency
      // adapter's `/settings/general` read with this same product body,
      // and `.find` on it throws (#3310).
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') return Promise.resolve([]);
        return Promise.resolve({ id: 42, name: 'Product', type: 'simple' });
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProduct('prod-internal-1');
      expect(result.id).toBe('prod-internal-1');
      expect(httpClient.get).toHaveBeenCalledWith('/wp-json/wc/v3/products/42');
    });

    it('should throw MasterProductNotFoundError when no mapping exists (#1599)', async () => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.getProduct('prod-missing')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should translate a WooCommerceHttpResponseException(404) to MasterProductNotFoundError (#1599)', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockRejectedValue(
        new WooCommerceHttpResponseException(404, 'Not found'),
      );
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '99', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.getProduct('prod-deleted')).rejects.toBeInstanceOf(
        MasterProductNotFoundError,
      );
    });
  });

  describe('getProducts', () => {
    it('should return empty array on empty HTTP response', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.getProducts();
      expect(result).toEqual([]);
    });

    it('should batch-map products with composite key externalId:connectionId', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 1 }, { id: 2 }] as WooCommerceProduct[]);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
        new Map([
          [`1:${CONNECTION_ID}`, 'internal-1'],
          [`2:${CONNECTION_ID}`, 'internal-2'],
        ]),
      );
      const mapper = makeMapper();
      const adapter = makeAdapter(httpClient, identifierMapping, mapper);
      const result = await adapter.getProducts();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-1');
      expect(result[1].id).toBe('internal-2');
    });

    it('should pass status=publish for status:active filter', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await adapter.getProducts({ status: 'active' });
      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ status: 'publish' }),
      );
    });

    it('should NOT pass status param when filter is absent', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await adapter.getProducts();
      const [, params] = httpClient.get.mock.calls[0];
      if (params !== undefined) {
        expect(params).not.toHaveProperty('status');
      }
    });

    it('should filter out products with undefined id before batch mapping', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([
        { id: 1 },
        { id: undefined },
      ] as WooCommerceProduct[]);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
        new Map([[`1:${CONNECTION_ID}`, 'internal-1']]),
      );
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProducts();
      expect(result).toHaveLength(1);
      const batchCall = identifierMapping.batchGetOrCreateInternalIds.mock.calls[0][0];
      expect(batchCall).toHaveLength(1);
      expect(batchCall[0].externalId).toBe('1');
    });
  });

  describe('getProductVariants — simple product', () => {
    it('should create synthetic variant with syntheticExternalId=product:{wcId}', async () => {
      const httpClient = makeHttpClient();
      // Path-aware: the price-basis read (ADR-077) reads `/settings/general`,
      // and a product body answered there is not a settings row list.
      routeSettingsAndProduct(httpClient, {
        id: 10,
        type: 'simple',
        sku: 'SIMPLE-001',
        price: '9.99',
        variations: [],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('variant-synthetic-1');
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProductVariants('prod-internal-1');
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.ProductVariant,
        'product:10',
        CONNECTION_ID,
        expect.objectContaining({ metadata: expect.objectContaining({ synthetic: true }) }),
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('variant-synthetic-1');
    });

    it('should preserve zero price on synthetic variant', async () => {
      const httpClient = makeHttpClient();
      routeSettingsAndProduct(httpClient, {
        id: 10,
        type: 'simple',
        price: '0',
        sku: 'FREE',
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('variant-1');
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProductVariants('prod-1');
      expect(result[0].price).toBe(0);
    });
  });

  describe('getProductVariants — variable product', () => {
    it('should fetch variations and batch-map them', async () => {
      const httpClient = makeHttpClient();
      httpClient.get
        .mockResolvedValueOnce({
          id: 20,
          type: 'variable',
          variations: [101, 102],
        } as WooCommerceProduct)
        .mockResolvedValueOnce([
          { id: 101 },
          { id: 102 },
        ] as WooCommerceProductVariation[]);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '20', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.deleteMapping.mockResolvedValue(undefined);
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
        new Map([
          [`101:${CONNECTION_ID}`, 'var-internal-1'],
          [`102:${CONNECTION_ID}`, 'var-internal-2'],
        ]),
      );
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProductVariants('prod-internal-2');
      expect(identifierMapping.deleteMapping).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.ProductVariant,
        'product:20',
        CONNECTION_ID,
      );
      expect(result).toHaveLength(2);
    });

    it('should filter variations with undefined id before batch mapping', async () => {
      const httpClient = makeHttpClient();
      httpClient.get
        .mockResolvedValueOnce({ id: 20, type: 'variable', variations: [101] } as WooCommerceProduct)
        .mockResolvedValueOnce([{ id: 101 }, { id: undefined }] as WooCommerceProductVariation[]);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '20', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.deleteMapping.mockResolvedValue(undefined);
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
        new Map([[`101:${CONNECTION_ID}`, 'var-1']]),
      );
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      const result = await adapter.getProductVariants('prod-1');
      expect(result).toHaveLength(1);
      const batchCall = identifierMapping.batchGetOrCreateInternalIds.mock.calls[0][0];
      expect(batchCall).toHaveLength(1);
    });

    it('should convert WooCommerceHttpResponseException(404) to WooCommerceResourceNotFoundException', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '99', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.getProductVariants('prod-deleted')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  describe('getCategories', () => {
    it('should map categories with id/name/parentId', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([
        { id: 1, name: 'Root', parent: 0 },
        { id: 2, name: 'Child', parent: 1 },
      ]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.getCategories?.() ?? [];
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: '1', name: 'Root', parentId: undefined });
      expect(result[1]).toEqual({ id: '2', name: 'Child', parentId: '1' });
    });

    it('should filter categories with undefined id', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([
        { id: 1, name: 'Valid' },
        { id: undefined, name: 'NoId' },
      ]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.getCategories?.() ?? [];
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('1');
    });

    it('should handle three-page exhaustion: page1=100, page2=100, page3=empty', async () => {
      const httpClient = makeHttpClient();
      const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Cat ${i + 1}`, parent: 0 }));
      const page2 = Array.from({ length: 100 }, (_, i) => ({ id: i + 101, name: `Cat ${i + 101}`, parent: 0 }));
      httpClient.get
        .mockResolvedValueOnce(page1)
        .mockResolvedValueOnce(page2)
        .mockResolvedValueOnce([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      const result = await adapter.getCategories?.() ?? [];
      expect(result).toHaveLength(200);
      expect(httpClient.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('getProductCategories', () => {
    it('should call endpoint with _fields=id,categories', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue({ categories: [{ id: 5, name: 'Electronics', slug: 'electronics' }] });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await adapter.getProductCategories('prod-1');
      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/42',
        expect.objectContaining({ _fields: 'id,categories' }),
      );
    });

    it('should convert WooCommerceHttpResponseException(404) to WooCommerceResourceNotFoundException', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.getProductCategories('prod-1')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  describe('searchProducts', () => {
    it('should delegate to getProducts with query merged into filters', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await adapter.searchProducts('laptop', { status: 'active' });
      expect(httpClient.get).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ search: 'laptop', status: 'publish' }),
      );
    });
  });

  // ─── Write methods ─────────────────────────────────────────────────────────

  describe('createProduct', () => {
    it('should POST to /wp-json/wc/v3/products, register mapping, and return mapped product', async () => {
      const httpClient = makeHttpClient();
      httpClient.post.mockResolvedValue({ id: 55, name: 'New Product', sku: 'NP-1' } as WooCommerceProduct);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getOrCreateInternalId.mockResolvedValue('prod-internal-new');
      const mapper = makeMapper();
      const adapter = makeAdapter(httpClient, identifierMapping, mapper);

      const result = await adapter.createProduct({ name: 'New Product', sku: 'NP-1', price: 19.99 });

      expect(httpClient.post).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products',
        expect.objectContaining({ name: 'New Product', sku: 'NP-1', regular_price: '19.99' }),
      );
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.Product,
        '55',
        CONNECTION_ID,
      );
      expect(mapper.mapProduct).toHaveBeenCalled();
      expect(result.id).toBe('prod-internal-new');
    });

    it('should propagate HTTP errors from POST', async () => {
      const httpClient = makeHttpClient();
      httpClient.post.mockRejectedValue(new WooCommerceHttpResponseException(422, 'Invalid data'));
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await expect(
        adapter.createProduct({ name: 'Bad', sku: 'BAD', price: 0 }),
      ).rejects.toBeInstanceOf(WooCommerceHttpResponseException);
    });

    it('should map WC product_invalid_sku (400) to WooCommerceDuplicateSkuException', async () => {
      const httpClient = makeHttpClient();
      httpClient.post.mockRejectedValue(
        new WooCommerceHttpResponseException(400, 'Invalid or duplicated SKU.', 'product_invalid_sku'),
      );
      const adapter = makeAdapter(httpClient, makeIdentifierMapping(), makeMapper());
      await expect(
        adapter.createProduct({ name: 'Dup', sku: 'DUP-1', price: 1 }),
      ).rejects.toBeInstanceOf(WooCommerceDuplicateSkuException);
    });
  });

  describe('updateProduct', () => {
    it('should PUT to /wp-json/wc/v3/products/{id} and return mapped product with original internal ID', async () => {
      const httpClient = makeHttpClient();
      httpClient.put.mockResolvedValue({ id: 42, name: 'Updated', sku: 'UP-1' } as WooCommerceProduct);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const mapper = makeMapper();
      const adapter = makeAdapter(httpClient, identifierMapping, mapper);

      const result = await adapter.updateProduct('prod-internal-1', { name: 'Updated', price: 25 });

      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/42',
        expect.objectContaining({ name: 'Updated', regular_price: '25' }),
      );
      expect(mapper.mapProduct).toHaveBeenCalled();
      expect(result.id).toBe('prod-internal-1');
    });

    it('should throw WooCommerceResourceNotFoundException when no OL identifier mapping exists', async () => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.updateProduct('prod-missing', { name: 'x' })).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
      expect(httpClient.put).not.toHaveBeenCalled();
    });

    it('should throw WooCommerceResourceNotFoundException when WC returns 404 on PUT (stale mapping)', async () => {
      const httpClient = makeHttpClient();
      httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.updateProduct('prod-internal-1', { name: 'x' })).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  describe('deleteProduct', () => {
    it('should DELETE /wp-json/wc/v3/products/{id} and return void', async () => {
      const httpClient = makeHttpClient();
      httpClient.delete.mockResolvedValue({ id: 42, status: 'trash' });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.deleteProduct('prod-internal-1');

      // force=true permanently deletes (bypasses WC trash), freeing the SKU.
      expect(httpClient.delete).toHaveBeenCalledWith('/wp-json/wc/v3/products/42', {
        force: true,
      });
      expect(result).toBeUndefined();
    });

    it('should throw WooCommerceResourceNotFoundException when no OL identifier mapping exists', async () => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.deleteProduct('prod-missing')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
      expect(httpClient.delete).not.toHaveBeenCalled();
    });

    it('should return void (idempotent) when WC returns 404 on DELETE (already trashed)', async () => {
      const httpClient = makeHttpClient();
      httpClient.delete.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.deleteProduct('prod-internal-1')).resolves.toBeUndefined();
    });
  });

  describe('upsertProductVariant', () => {
    function makeVariationResponse(id: number): WooCommerceProductVariation {
      return { id, sku: `VAR-${id}`, price: '9.99' };
    }

    it('should POST new variation when SKU not found, register mapping, and return mapped variant', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([]); // no existing variations
      httpClient.post.mockResolvedValue(makeVariationResponse(200));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('var-internal-new');
      const mapper = makeMapper();
      const adapter = makeAdapter(httpClient, identifierMapping, mapper);

      const result = await adapter.upsertProductVariant('prod-internal-1', { sku: 'VAR-NEW', price: 9.99 });

      expect(httpClient.post).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/10/variations',
        expect.objectContaining({ sku: 'VAR-NEW', regular_price: '9.99' }),
      );
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.ProductVariant,
        '200',
        CONNECTION_ID,
        expect.objectContaining({ parentEntityType: CORE_ENTITY_TYPE.Product, parentInternalId: 'prod-internal-1' }),
      );
      expect(mapper.mapVariation).toHaveBeenCalled();
      expect(result.id).toBe('var-internal-new');
    });

    it('should PUT existing variation when SKU matches and register mapping', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 101, sku: 'VAR-EXIST' }] as WooCommerceProductVariation[]);
      httpClient.put.mockResolvedValue(makeVariationResponse(101));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('var-internal-exist');
      const mapper = makeMapper();
      const adapter = makeAdapter(httpClient, identifierMapping, mapper);

      const result = await adapter.upsertProductVariant('prod-internal-1', { sku: 'VAR-EXIST', price: 15 });

      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/10/variations/101',
        expect.objectContaining({ sku: 'VAR-EXIST', regular_price: '15' }),
      );
      expect(httpClient.post).not.toHaveBeenCalled();
      // Should use the pre-known existing.id (101), not the PUT response id,
      // to avoid registering "undefined" if WC omitted id from the response.
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.ProductVariant,
        '101',
        CONNECTION_ID,
        expect.objectContaining({ parentEntityType: CORE_ENTITY_TYPE.Product }),
      );
      expect(result.id).toBe('var-internal-exist');
    });

    it('should call getOrCreateInternalId on update path even when mapping already existed (idempotent)', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 101, sku: 'VAR-EXIST' }] as WooCommerceProductVariation[]);
      httpClient.put.mockResolvedValue(makeVariationResponse(101));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      // Already exists — returns the same existing ID
      identifierMapping.getOrCreateInternalId.mockResolvedValue('var-already-mapped');
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.upsertProductVariant('prod-internal-1', { sku: 'VAR-EXIST' });

      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledTimes(1);
      expect(result.id).toBe('var-already-mapped');
    });

    it('should throw WooCommerceResourceNotFoundException when no OL mapping for parent product', async () => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(
        adapter.upsertProductVariant('prod-missing', { sku: 'VAR-1' }),
      ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
      expect(httpClient.get).not.toHaveBeenCalled();
    });

    it('should throw WooCommerceResourceNotFoundException when WC returns 404 on variation PUT (variation deleted between GET and PUT)', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue([{ id: 101, sku: 'VAR-EXIST' }] as WooCommerceProductVariation[]);
      httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(
        adapter.upsertProductVariant('prod-internal-1', { sku: 'VAR-EXIST' }),
      ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalled();
    });

    it('should throw WooCommerceResourceNotFoundException when WC returns 404 on variations GET (parent deleted)', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(
        adapter.upsertProductVariant('prod-deleted', { sku: 'VAR-1' }),
      ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
    });

    it('should exhaust all variation pages so a SKU on page 2+ is updated, not duplicated', async () => {
      const httpClient = makeHttpClient();
      // Page 1 returns a full 100 items (none matching the target SKU); the
      // target SKU lives on page 2. fetchAllPages must fetch page 2 and find
      // it — otherwise a duplicate variation would be POSTed.
      const page1 = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        sku: `SKU-${i + 1}`,
      })) as WooCommerceProductVariation[];
      const page2 = [{ id: 201, sku: 'SKU-PAGE-2' }] as WooCommerceProductVariation[];
      httpClient.get.mockResolvedValueOnce(page1).mockResolvedValueOnce(page2);
      httpClient.put.mockResolvedValue(makeVariationResponse(201));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '10', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('var-page-2');
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.upsertProductVariant('prod-internal-1', { sku: 'SKU-PAGE-2' });

      // Found on page 2 → PUT (update), never POST (duplicate).
      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/10/variations/201',
        expect.objectContaining({ sku: 'SKU-PAGE-2' }),
      );
      expect(httpClient.post).not.toHaveBeenCalled();
      expect(result.id).toBe('var-page-2');
    });
  });

  describe('assignCategories', () => {
    it('should PUT /wp-json/wc/v3/products/{id} with categories as numeric IDs', async () => {
      const httpClient = makeHttpClient();
      httpClient.put.mockResolvedValue({ id: 42 });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await adapter.assignCategories('prod-internal-1', ['5', '12']);

      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/42',
        { categories: [{ id: 5 }, { id: 12 }] },
      );
    });

    it('should throw WooCommerceResourceNotFoundException when no OL identifier mapping exists', async () => {
      const httpClient = makeHttpClient();
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.assignCategories('prod-missing', ['5'])).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
      expect(httpClient.put).not.toHaveBeenCalled();
    });

    it('should throw WooCommerceResourceNotFoundException when WC returns 404 on PUT (stale mapping)', async () => {
      const httpClient = makeHttpClient();
      httpClient.put.mockRejectedValue(new WooCommerceHttpResponseException(404, 'Not found'));
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());
      await expect(adapter.assignCategories('prod-deleted', ['5'])).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  // #2054 review — the master's tax answer. `unknown` is persisted by the sync as
  // the *no-rate* state, which blocks documents and refuses publishes, so the
  // line between "the store answered" and "the read established nothing" is the
  // whole subject here.
  describe('readProductTaxRate (#2054, ADR-063)', () => {
    function mappingFor(externalId: string, entityType: string) {
      return {
        externalId,
        connectionId: CONNECTION_ID,
        platformType: 'woocommerce',
        entityType,
      };
    }

    function respond(
      httpClient: jest.Mocked<IWooCommerceHttpClient>,
      routes: {
        product?: unknown;
        // Either a settings payload or a zero-arg thunk simulating a throwing
        // read — `unknown` already covers a function value, so the explicit
        // union is redundant for TS but documents the intended shape.
        settings?: unknown;
        taxes?: unknown;
        variation?: unknown;
      },
    ): void {
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') {
          const settings = routes.settings;
          if (typeof settings === 'function') (settings as () => never)();
          return Promise.resolve(settings);
        }
        if (path === '/wp-json/wc/v3/taxes') return Promise.resolve(routes.taxes ?? []);
        if (path.includes('/variations/')) return Promise.resolve(routes.variation ?? {});
        return Promise.resolve(routes.product ?? {});
      });
    }

    const PL_SETTINGS = [{ id: 'woocommerce_default_country', value: 'PL:MZ' }];

    it('should resolve the single matching rate for the store country', async () => {
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'taxable' },
        settings: PL_SETTINGS,
        taxes: [{ id: 1, country: 'PL', rate: '23.0000' }],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.readProductTaxRate({ productId: 'prod-1' })).resolves.toEqual({
        kind: 'resolved',
        code: '23',
        countryIso2: 'PL',
      });
    });

    it('should THROW when the store-settings read fails, instead of reporting an answer', async () => {
      // The defect this replaces: the failure was swallowed into
      // `unknown/unreadable`, which the sync persisted as `{ code: null, readAt }`
      // - so one 500 on /settings/general during a sweep recorded a whole
      // catalogue as rate-less. The capability contract says a transport failure
      // propagates; the sync then leaves the row untouched.
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'taxable' },
        settings: () => {
          throw new WooCommerceHttpResponseException(500, 'Internal Server Error');
        },
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.readProductTaxRate({ productId: 'prod-1' })).rejects.toBeInstanceOf(
        WooCommerceHttpResponseException,
      );
    });

    it('should not cache a failed store-country read, so a later read still answers', async () => {
      const httpClient = makeHttpClient();
      let settingsCall = 0;
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') {
          settingsCall += 1;
          if (settingsCall === 1) {
            return Promise.reject(new WooCommerceHttpResponseException(500, 'boom'));
          }
          return Promise.resolve(PL_SETTINGS);
        }
        if (path === '/wp-json/wc/v3/taxes') {
          return Promise.resolve([{ id: 1, country: 'PL', rate: '23.0000' }]);
        }
        return Promise.resolve({ id: 42, tax_class: '', tax_status: 'taxable' });
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.readProductTaxRate({ productId: 'prod-1' })).rejects.toBeInstanceOf(
        WooCommerceHttpResponseException,
      );
      await expect(adapter.readProductTaxRate({ productId: 'prod-1' })).resolves.toEqual({
        kind: 'resolved',
        code: '23',
        countryIso2: 'PL',
      });
    });

    it('should report not-configured (a persistable answer) when the store declares no selling country', async () => {
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'taxable' },
        settings: [{ id: 'woocommerce_default_country', value: '' }],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.readProductTaxRate({ productId: 'prod-1' });

      expect(result).toEqual({
        kind: 'unknown',
        reason: 'not-configured',
        detail: 'the store does not declare a selling country',
      });
    });

    it('should keep a resolved zero even when the country read (provenance only) fails', async () => {
      // `tax_status: 'none'` is the operator saying this product is not taxed,
      // whatever the store's country turns out to be - and `countryIso2` is
      // documented as provenance that blocks nothing, so losing it must not lose
      // the rate.
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'none' },
        settings: () => {
          throw new WooCommerceHttpResponseException(500, 'boom');
        },
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.readProductTaxRate({ productId: 'prod-1' })).resolves.toEqual({
        kind: 'resolved',
        code: '0',
        countryIso2: null,
      });
    });

    it('should report ambiguous when the class carries several different rates', async () => {
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'taxable' },
        settings: PL_SETTINGS,
        taxes: [
          { id: 1, country: 'PL', rate: '23.0000' },
          { id: 2, country: 'PL', rate: '8.0000' },
        ],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.readProductTaxRate({ productId: 'prod-1' });

      expect(result).toEqual(
        expect.objectContaining({ kind: 'unknown', reason: 'ambiguous' }),
      );
    });

    it('should report not-configured when the class has no rate for the store country', async () => {
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: 'reduced-rate', tax_status: 'taxable' },
        settings: PL_SETTINGS,
        taxes: [{ id: 1, country: 'DE', rate: '19.0000' }],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([mappingFor('42', 'Product')]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.readProductTaxRate({ productId: 'prod-1' });

      expect(result).toEqual(
        expect.objectContaining({ kind: 'unknown', reason: 'not-configured' }),
      );
    });

    it('should report inherited for a variation on the parent tax class', async () => {
      const httpClient = makeHttpClient();
      respond(httpClient, {
        product: { id: 42, tax_class: '', tax_status: 'taxable' },
        settings: PL_SETTINGS,
        variation: { id: 77, tax_class: 'parent' },
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockImplementation((entityType: string) =>
        Promise.resolve([
          entityType === CORE_ENTITY_TYPE.Product
            ? mappingFor('42', 'Product')
            : mappingFor('77', 'ProductVariant'),
        ]),
      );
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(
        adapter.readProductTaxRate({ productId: 'prod-1', variantId: 'var-1' }),
      ).resolves.toEqual({ kind: 'inherited' });
    });
  });

  describe('store currency resolution (#3310)', () => {
    const PLN_SETTINGS = [
      { id: 'woocommerce_default_country', value: 'PL:MZ' },
      { id: 'woocommerce_currency', value: 'PLN' },
    ];

    function respondByPath(
      httpClient: jest.Mocked<IWooCommerceHttpClient>,
      routes: {
        product?: unknown;
        settings?: unknown;
      },
    ): void {
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') {
          const settings = routes.settings;
          if (typeof settings === 'function') (settings as () => never)();
          return Promise.resolve(settings);
        }
        return Promise.resolve(routes.product ?? {});
      });
    }

    it('should resolve currency from the store settings on getProduct', async () => {
      const httpClient = makeHttpClient();
      respondByPath(httpClient, {
        product: { id: 42, name: 'Product', type: 'simple' },
        settings: PLN_SETTINGS,
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.getProduct('prod-internal-1');

      expect(result.currency).toBe('PLN');
    });

    it('should resolve currency from the store settings on getProducts', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') return Promise.resolve(PLN_SETTINGS);
        return Promise.resolve([{ id: 1 }]);
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
        new Map([[`1:${CONNECTION_ID}`, 'internal-1']]),
      );
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.getProducts();

      expect(result).toHaveLength(1);
      expect(result[0].currency).toBe('PLN');
    });

    it('should keep currency null when the store declares none — no defaulted or guessed code', async () => {
      const httpClient = makeHttpClient();
      respondByPath(httpClient, {
        product: { id: 42, name: 'Product', type: 'simple' },
        settings: [{ id: 'woocommerce_default_country', value: 'PL' }],
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const result = await adapter.getProduct('prod-internal-1');

      expect(result.currency).toBeNull();
    });

    it('should throw on a transport failure reading /settings/general, never reporting "the store declares none"', async () => {
      const httpClient = makeHttpClient();
      respondByPath(httpClient, {
        product: { id: 42, name: 'Product', type: 'simple' },
        settings: () => {
          throw new WooCommerceHttpResponseException(500, 'Internal Server Error');
        },
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.getProduct('prod-internal-1')).rejects.toBeInstanceOf(
        WooCommerceHttpResponseException,
      );
    });

    it('should not cache a failed currency read, so a later read still answers', async () => {
      const httpClient = makeHttpClient();
      let settingsCall = 0;
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') {
          settingsCall += 1;
          if (settingsCall === 1) {
            return Promise.reject(new WooCommerceHttpResponseException(500, 'boom'));
          }
          return Promise.resolve(PLN_SETTINGS);
        }
        return Promise.resolve({ id: 42, name: 'Product', type: 'simple' });
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      await expect(adapter.getProduct('prod-internal-1')).rejects.toBeInstanceOf(
        WooCommerceHttpResponseException,
      );
      const result = await adapter.getProduct('prod-internal-1');
      expect(result.currency).toBe('PLN');
    });

    it('should fetch /settings/general at most once per adapter instance when both country and currency are needed', async () => {
      const httpClient = makeHttpClient();
      let settingsCalls = 0;
      httpClient.get.mockImplementation((path: string) => {
        if (path === '/wp-json/wc/v3/settings/general') {
          settingsCalls += 1;
          return Promise.resolve(PLN_SETTINGS);
        }
        if (path === '/wp-json/wc/v3/taxes') {
          return Promise.resolve([{ id: 1, country: 'PL', rate: '23.0000' }]);
        }
        return Promise.resolve({ id: 42, name: 'Product', type: 'simple', tax_class: '', tax_status: 'taxable' });
      });
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([
        { externalId: '42', connectionId: CONNECTION_ID, platformType: 'woocommerce', entityType: 'Product' },
      ]);
      const adapter = makeAdapter(httpClient, identifierMapping, makeMapper());

      const product = await adapter.getProduct('prod-internal-1'); // resolves currency
      const rate = await adapter.readProductTaxRate({ productId: 'prod-internal-1' }); // resolves country

      expect(product.currency).toBe('PLN');
      expect(rate).toEqual(expect.objectContaining({ kind: 'resolved', countryIso2: 'PL' }));
      expect(settingsCalls).toBe(1);
    });
  });

  // ADR-077: a catalogue price is what the buyer pays. A store that taxes and
  // enters prices without tax stores net figures, so the master grosses them up
  // with the store's own class x country rate; a price it cannot state gross is
  // absent, never net. These tests drive the REAL mapper so the regular-price
  // read and the gross overlay are covered together.
  describe('catalogue price is gross (ADR-077)', () => {
    const GENERAL_SETTINGS = '/wp-json/wc/v3/settings/general';
    const TAX_SETTINGS = '/wp-json/wc/v3/settings/tax';
    const TAX_CLASSES = '/wp-json/wc/v3/taxes/classes';
    const TAX_RATES = '/wp-json/wc/v3/taxes';

    interface PriceStore {
      calcTaxes?: 'yes' | 'no';
      pricesIncludeTax?: 'yes' | 'no';
      /** `woocommerce_default_country`; defaults to `'PL'`. */
      country?: string;
      priceDecimals?: string;
      classes?: string[];
      rates?: Record<string, WooCommerceTaxRate[]>;
      product?: WooCommerceProduct;
      products?: WooCommerceProduct[];
      variations?: WooCommerceProductVariation[];
      /** Paths whose FIRST read answers 500; later reads succeed. */
      failOnce?: string[];
    }

    const POLISH_RATES: Record<string, WooCommerceTaxRate[]> = {
      standard: [{ country: 'PL', rate: '23.0000' }],
      'reduced-rate': [{ country: 'PL', rate: '8.0000' }],
    };

    /** Taxes on, prices entered WITHOUT tax, standard 23% and reduced 8% for PL. */
    const TAX_EXCLUSIVE_STORE: PriceStore = {
      calcTaxes: 'yes',
      pricesIncludeTax: 'no',
      classes: ['reduced-rate'],
      rates: POLISH_RATES,
    };

    function routeStore(httpClient: jest.Mocked<IWooCommerceHttpClient>, store: PriceStore): void {
      const failed = new Set<string>();
      httpClient.get.mockImplementation(
        (path: string, params?: Record<string, string | number | boolean>) => {
          if (store.failOnce?.includes(path) && !failed.has(path)) {
            failed.add(path);
            return Promise.reject(new WooCommerceHttpResponseException(500, `boom on ${path}`));
          }
          if (path === GENERAL_SETTINGS) {
            const rows: WooCommerceGeneralSetting[] = [
              { id: 'woocommerce_calc_taxes', value: store.calcTaxes ?? 'yes' },
              { id: 'woocommerce_default_country', value: store.country ?? 'PL' },
              { id: 'woocommerce_currency', value: 'PLN' },
            ];
            if (store.priceDecimals !== undefined) {
              rows.push({ id: 'woocommerce_price_num_decimals', value: store.priceDecimals });
            }
            return Promise.resolve(rows);
          }
          if (path === TAX_SETTINGS) {
            return Promise.resolve([
              { id: 'woocommerce_prices_include_tax', value: store.pricesIncludeTax ?? 'no' },
            ]);
          }
          if (path === '/wp-json/wc/v3/settings/products') return Promise.resolve([]);
          if (path === TAX_CLASSES) {
            return Promise.resolve(
              ['standard', ...(store.classes ?? [])].map((slug) => ({ slug, name: slug })),
            );
          }
          if (path === TAX_RATES) {
            return Promise.resolve(
              params?.page === 1 ? (store.rates?.[String(params?.class)] ?? []) : [],
            );
          }
          if (path.endsWith('/variations')) {
            return Promise.resolve(params?.page === 1 ? (store.variations ?? []) : []);
          }
          if (path === '/wp-json/wc/v3/products') return Promise.resolve(store.products ?? []);
          if (path.startsWith('/wp-json/wc/v3/products/')) {
            return Promise.resolve(store.product ?? {});
          }
          return Promise.reject(new Error(`unexpected GET ${path}`));
        },
      );
    }

    function callsTo(httpClient: jest.Mocked<IWooCommerceHttpClient>, path: string): number {
      return httpClient.get.mock.calls.filter(([calledPath]) => calledPath === path).length;
    }

    function productMapping(externalId: string) {
      return {
        externalId,
        connectionId: CONNECTION_ID,
        platformType: 'woocommerce',
        entityType: 'Product',
      };
    }

    function makeRealAdapter(
      httpClient: jest.Mocked<IWooCommerceHttpClient>,
      identifierMapping: jest.Mocked<IdentifierMappingPort>,
    ): WooCommerceProductMasterAdapter {
      return new WooCommerceProductMasterAdapter(
        httpClient,
        identifierMapping,
        new WooCommerceProductMapper({}),
        mockConnection,
      );
    }

    function silenceWarn(adapter: WooCommerceProductMasterAdapter): jest.SpyInstance<void, [string]> {
      return jest
        .spyOn(
          (adapter as unknown as { logger: { warn: (message: string) => void } }).logger,
          'warn',
        )
        .mockImplementation(() => undefined);
    }

    function grossUnavailableWarnings(warn: jest.SpyInstance<void, [string]>): string[] {
      return warn.mock.calls
        .map(([message]) => message)
        .filter((message) => message.includes('woocommerce_gross_price_unavailable'));
    }

    async function readProduct(
      store: PriceStore,
    ): Promise<{ price: number | null; httpClient: jest.Mocked<IWooCommerceHttpClient> }> {
      const httpClient = makeHttpClient();
      routeStore(httpClient, store);
      const identifierMapping = makeIdentifierMapping();
      identifierMapping.getExternalIds.mockResolvedValue([productMapping('42')]);
      const adapter = makeRealAdapter(httpClient, identifierMapping);
      silenceWarn(adapter);

      const product = await adapter.getProduct('prod-internal-1');

      return { price: product.price, httpClient };
    }

    describe('getProduct', () => {
      it('should report the stored price as it is when the store enters prices with tax', async () => {
        const { price, httpClient } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          pricesIncludeTax: 'yes',
          product: { id: 42, type: 'simple', regular_price: '123.00', tax_class: '', tax_status: 'taxable' },
        });

        expect(price).toBe(123);
        expect(callsTo(httpClient, TAX_CLASSES)).toBe(0);
      });

      it('should report the stored price as it is when the store does not calculate taxes', async () => {
        const { price, httpClient } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          calcTaxes: 'no',
          product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: '', tax_status: 'taxable' },
        });

        expect(price).toBe(100);
        expect(callsTo(httpClient, TAX_SETTINGS)).toBe(0);
        expect(callsTo(httpClient, TAX_CLASSES)).toBe(0);
      });

      it('should gross up with the standard rate for the store country when the store enters prices without tax', async () => {
        const { price } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: '', tax_status: 'taxable' },
        });

        expect(price).toBe(123);
      });

      it('should gross up with the rate of the product own tax class when it has one', async () => {
        // 9.99 x 1.08 = 10.7892
        const { price } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 42,
            type: 'simple',
            regular_price: '9.99',
            tax_class: 'reduced-rate',
            tax_status: 'taxable',
          },
        });

        expect(price).toBe(10.79);
      });

      it('should gross up the regular price, not the sale price, when a promotion is running', async () => {
        const { price } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 42,
            type: 'simple',
            regular_price: '100.00',
            price: '80.00',
            tax_class: '',
            tax_status: 'taxable',
          },
        });

        expect(price).toBe(123);
      });

      it('should report the stored price as it is when the store does not tax the product', async () => {
        const { price, httpClient } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: '', tax_status: 'none' },
        });

        expect(price).toBe(100);
        expect(callsTo(httpClient, TAX_CLASSES)).toBe(0);
      });

      it('should round the gross price to the store price decimals when the store shows whole units', async () => {
        // 9.99 x 1.23 = 12.2877
        const { price } = await readProduct({
          ...TAX_EXCLUSIVE_STORE,
          priceDecimals: '0',
          product: { id: 42, type: 'simple', regular_price: '9.99', tax_class: '', tax_status: 'taxable' },
        });

        expect(price).toBe(12);
      });

      it('should report no price and warn once when the tax class has no rate for the store country', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: 'luxury', tax_status: 'taxable' },
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('42')]);
        const adapter = makeRealAdapter(httpClient, identifierMapping);
        const warn = silenceWarn(adapter);

        const first = await adapter.getProduct('prod-internal-1');
        const second = await adapter.getProduct('prod-internal-1');

        expect(first.price).toBeNull();
        expect(second.price).toBeNull();
        const warnings = grossUnavailableWarnings(warn);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("'luxury'");
        expect(warnings[0]).toContain('PL');
      });

      it('should report no price and warn when the store declares no base country', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          country: '',
          product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: '', tax_status: 'taxable' },
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('42')]);
        const adapter = makeRealAdapter(httpClient, identifierMapping);
        const warn = silenceWarn(adapter);

        const product = await adapter.getProduct('prod-internal-1');

        expect(product.price).toBeNull();
        const warnings = grossUnavailableWarnings(warn);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('no base country');
        expect(callsTo(httpClient, TAX_CLASSES)).toBe(0);
      });

      it.each([TAX_SETTINGS, TAX_CLASSES, TAX_RATES])(
        'should throw instead of reporting no price when the %s read fails, and answer on the next read',
        async (failingPath) => {
          const httpClient = makeHttpClient();
          routeStore(httpClient, {
            ...TAX_EXCLUSIVE_STORE,
            failOnce: [failingPath],
            product: { id: 42, type: 'simple', regular_price: '100.00', tax_class: '', tax_status: 'taxable' },
          });
          const identifierMapping = makeIdentifierMapping();
          identifierMapping.getExternalIds.mockResolvedValue([productMapping('42')]);
          const adapter = makeRealAdapter(httpClient, identifierMapping);
          const warn = silenceWarn(adapter);

          await expect(adapter.getProduct('prod-internal-1')).rejects.toBeInstanceOf(
            WooCommerceHttpResponseException,
          );
          const product = await adapter.getProduct('prod-internal-1');

          expect(product.price).toBe(123);
          expect(grossUnavailableWarnings(warn)).toHaveLength(0);
        },
      );
    });

    describe('getProducts', () => {
      it('should gross up every product of a page with its own class rate and read the store settings once', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          products: [
            { id: 1, type: 'simple', regular_price: '100', tax_class: '', tax_status: 'taxable' },
            { id: 2, type: 'simple', regular_price: '10', tax_class: 'reduced-rate', tax_status: 'taxable' },
          ],
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
          new Map([
            [`1:${CONNECTION_ID}`, 'internal-1'],
            [`2:${CONNECTION_ID}`, 'internal-2'],
          ]),
        );
        const adapter = makeRealAdapter(httpClient, identifierMapping);

        const result = await adapter.getProducts();

        expect(result.map((p) => p.price)).toEqual([123, 10.8]);
        expect(callsTo(httpClient, GENERAL_SETTINGS)).toBe(1);
        expect(callsTo(httpClient, TAX_SETTINGS)).toBe(1);
        expect(callsTo(httpClient, TAX_CLASSES)).toBe(1);
      });
    });

    describe('getProductVariants', () => {
      it('should gross up the regular price of a simple product synthetic variant with its class rate', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 10,
            type: 'simple',
            sku: 'SIMPLE-001',
            regular_price: '100',
            price: '90',
            tax_class: 'reduced-rate',
            tax_status: 'taxable',
          },
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('10')]);
        identifierMapping.getOrCreateInternalId.mockResolvedValue('variant-synthetic-1');
        const adapter = makeRealAdapter(httpClient, identifierMapping);

        const result = await adapter.getProductVariants('prod-internal-1');

        expect(result).toHaveLength(1);
        expect(result[0].price).toBe(108);
      });

      it('should report no price on a simple product synthetic variant when its class has no rate', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: { id: 10, type: 'simple', regular_price: '100', tax_class: 'luxury', tax_status: 'taxable' },
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('10')]);
        identifierMapping.getOrCreateInternalId.mockResolvedValue('variant-synthetic-1');
        const adapter = makeRealAdapter(httpClient, identifierMapping);
        const warn = silenceWarn(adapter);

        const result = await adapter.getProductVariants('prod-internal-1');

        expect(result[0].price).toBeUndefined();
        expect(grossUnavailableWarnings(warn)).toHaveLength(1);
      });

      it('should throw instead of reporting no price when the store settings read fails', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          failOnce: [GENERAL_SETTINGS],
          product: { id: 10, type: 'simple', regular_price: '100', tax_class: '', tax_status: 'taxable' },
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('10')]);
        identifierMapping.getOrCreateInternalId.mockResolvedValue('variant-synthetic-1');
        const adapter = makeRealAdapter(httpClient, identifierMapping);

        await expect(adapter.getProductVariants('prod-internal-1')).rejects.toBeInstanceOf(
          WooCommerceHttpResponseException,
        );
        const result = await adapter.getProductVariants('prod-internal-1');

        expect(result[0].price).toBe(123);
      });

      it('should gross up each variation with its effective class, inheriting the parent class and status', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 20,
            type: 'variable',
            variations: [101, 102, 103, 104],
            tax_class: 'reduced-rate',
            tax_status: 'taxable',
          },
          variations: [
            // `parent` class: the parent's reduced rate, 8%.
            { id: 101, regular_price: '10', price: '10', tax_class: 'parent' },
            // Its own standard class, 23%.
            { id: 102, regular_price: '10', price: '10', tax_class: '' },
            // On sale: the regular price is the catalogue price.
            { id: 103, regular_price: '20', price: '15', tax_class: 'parent' },
            // Its own `none` status: not taxed, the stored price stands.
            { id: 104, regular_price: '10', price: '10', tax_class: 'parent', tax_status: 'none' },
          ],
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('20')]);
        identifierMapping.deleteMapping.mockResolvedValue(undefined);
        identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
          new Map([
            [`101:${CONNECTION_ID}`, 'var-101'],
            [`102:${CONNECTION_ID}`, 'var-102'],
            [`103:${CONNECTION_ID}`, 'var-103'],
            [`104:${CONNECTION_ID}`, 'var-104'],
          ]),
        );
        const adapter = makeRealAdapter(httpClient, identifierMapping);

        const result = await adapter.getProductVariants('prod-internal-1');

        const priceById = new Map(
          result.map((variant): [string, number | undefined] => [variant.id, variant.price]),
        );
        expect(priceById.get('var-101')).toBe(10.8);
        expect(priceById.get('var-102')).toBe(12.3);
        expect(priceById.get('var-103')).toBe(21.6);
        expect(priceById.get('var-104')).toBe(10);
      });

      it('should use the parent tax status for a variation that states none of its own', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 20,
            type: 'variable',
            variations: [101, 102],
            tax_class: '',
            tax_status: 'none',
          },
          variations: [
            { id: 101, regular_price: '10', tax_class: 'parent' },
            { id: 102, regular_price: '10', tax_class: 'parent', tax_status: 'taxable' },
          ],
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('20')]);
        identifierMapping.deleteMapping.mockResolvedValue(undefined);
        identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
          new Map([
            [`101:${CONNECTION_ID}`, 'var-101'],
            [`102:${CONNECTION_ID}`, 'var-102'],
          ]),
        );
        const adapter = makeRealAdapter(httpClient, identifierMapping);

        const result = await adapter.getProductVariants('prod-internal-1');

        const priceById = new Map(
          result.map((variant): [string, number | undefined] => [variant.id, variant.price]),
        );
        // Inherits the parent's `none`: not taxed, stored price stands.
        expect(priceById.get('var-101')).toBe(10);
        // States `taxable` itself: grossed up at the standard 23%.
        expect(priceById.get('var-102')).toBe(12.3);
      });

      it('should leave the price off a variation and warn when its class has no rate', async () => {
        const httpClient = makeHttpClient();
        routeStore(httpClient, {
          ...TAX_EXCLUSIVE_STORE,
          product: {
            id: 20,
            type: 'variable',
            variations: [101],
            tax_class: 'luxury',
            tax_status: 'taxable',
          },
          variations: [{ id: 101, regular_price: '10', tax_class: 'parent' }],
        });
        const identifierMapping = makeIdentifierMapping();
        identifierMapping.getExternalIds.mockResolvedValue([productMapping('20')]);
        identifierMapping.deleteMapping.mockResolvedValue(undefined);
        identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(
          new Map([[`101:${CONNECTION_ID}`, 'var-101']]),
        );
        const adapter = makeRealAdapter(httpClient, identifierMapping);
        const warn = silenceWarn(adapter);

        const result = await adapter.getProductVariants('prod-internal-1');

        expect(result).toHaveLength(1);
        expect('price' in result[0]).toBe(false);
        const warnings = grossUnavailableWarnings(warn);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('variation 101');
      });
    });
  });
});

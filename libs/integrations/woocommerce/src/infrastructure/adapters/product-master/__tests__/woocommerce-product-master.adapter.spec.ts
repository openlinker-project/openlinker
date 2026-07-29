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
import type { WooCommerceProduct, WooCommerceProductVariation } from '../woocommerce-product.types';

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

  describe('getProduct', () => {
    it('should return product with internal ID', async () => {
      const httpClient = makeHttpClient();
      httpClient.get.mockResolvedValue({ id: 42, name: 'Product', type: 'simple' });
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
      httpClient.get.mockResolvedValue({
        id: 10,
        type: 'simple',
        sku: 'SIMPLE-001',
        price: '9.99',
        variations: [],
      } as WooCommerceProduct);
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
      httpClient.get.mockResolvedValue({
        id: 10,
        type: 'simple',
        price: '0',
        sku: 'FREE',
      } as WooCommerceProduct);
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
});

/**
 * PrestaShop Product Master Adapter Tests
 *
 * Unit tests for PrestashopProductMasterAdapter. Tests product fetching,
 * variant retrieval, identifier mapping, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopProductMasterAdapter } from '../prestashop-product-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { samplePrestashopProduct } from '../../../__tests__/fixtures/prestashop-product.fixture';
import { PrestashopProductMapper } from '../../mappers/prestashop-product.mapper';
import { PrestashopAttributeResolver } from '../../provisioners/prestashop-attribute.resolver';
import { PrestashopFeatureResolver } from '../../provisioners/prestashop-feature.resolver';
import { PrestashopCategoryPathResolver } from '../../provisioners/prestashop-category-path.resolver';
import {
  PrestashopResourceNotFoundException,
  PrestashopNotSupportedException,
} from '@openlinker/integrations-prestashop';
import { MasterProductNotFoundError } from '@openlinker/core/products';
import type {
  PrestashopProduct,
  PrestashopCombination,
} from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

describe('PrestashopProductMasterAdapter', () => {
  let adapter: PrestashopProductMasterAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let productMapper: PrestashopProductMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockIdentifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    productMapper = new PrestashopProductMapper({ storefrontBaseUrl: 'https://shop.test' });

    adapter = new PrestashopProductMasterAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      productMapper,
      connection
    );
  });

  describe('getProduct', () => {
    it('should fetch and map a product successfully', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProduct(internalId);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', internalId);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId);
      expect(result.id).toBe(internalId);
      expect(result.name).toBe('Test Product');
      expect(result.sku).toBe('TEST-001');
    });

    it('should throw MasterProductNotFoundError when no external ID mapping exists (#1599)', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProduct(internalId)).rejects.toThrow(MasterProductNotFoundError);
    });

    it('should throw MasterProductNotFoundError when external ID not found for this connection (#1599)', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: 'other-connection-id',
          externalId: '42',
          entityType: 'Product',
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProduct(internalId)).rejects.toThrow(MasterProductNotFoundError);
    });

    it('should use connection langId from config', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';
      const connectionWithLang = createTestConnection({
        config: { ...connection.config, langId: 2 },
      });

      const adapterWithLang = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connectionWithLang
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connectionWithLang.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      await adapterWithLang.getProduct(internalId);

      // Verify mapper was called with langId 2
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.getResource).toHaveBeenCalled();
    });
  });

  describe('getProduct — features & category path (#1096)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function mapExternalId(): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
    }

    it('enriches the product with resolved features when a feature resolver is wired (F2)', async () => {
      mapExternalId();
      const productWithFeatures: PrestashopProduct = {
        ...samplePrestashopProduct,
        associations: {
          ...(samplePrestashopProduct.associations as Record<string, unknown>),
          product_features: [{ id: '1', id_feature_value: '10' }],
        },
      };

      mockHttpClient.getResource = jest.fn().mockResolvedValue(productWithFeatures);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'product_features') return Promise.resolve([{ id: '1', name: 'Material' }]);
        if (resource === 'product_feature_values')
          return Promise.resolve([{ id: '10', value: 'Ceramic' }]);
        return Promise.resolve([]);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      const featureResolver = new PrestashopFeatureResolver();
      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        featureResolver
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.features).toEqual([{ name: 'Material', value: 'Ceramic' }]);
    });

    it('leaves features unset when no feature resolver is wired (F2)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      const result = await adapter.getProduct(internalId);

      expect(result.features).toBeUndefined();
    });

    it('does not break sync when the feature resolver throws (F2)', async () => {
      mapExternalId();
      const productWithFeatures: PrestashopProduct = {
        ...samplePrestashopProduct,
        associations: { product_features: [{ id: '1', id_feature_value: '10' }] },
      };
      mockHttpClient.getResource = jest.fn().mockResolvedValue(productWithFeatures);
      mockHttpClient.listResources = jest
        .fn()
        .mockRejectedValue(new Error('boom')) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver()
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.features).toBeUndefined();
      expect(result.id).toBe(internalId);
    });

    it('enriches the product with a full category breadcrumb (F3)', async () => {
      mapExternalId();
      const productWithCategory: PrestashopProduct = {
        ...samplePrestashopProduct,
        id_category_default: '12',
      };
      const categories: Record<string, { id: string; name: string; id_parent: string }> = {
        '5': { id: '5', name: 'Home & Garden', id_parent: '2' },
        '12': { id: '12', name: 'Mugs', id_parent: '5' },
      };
      mockHttpClient.getResource = jest.fn((resource: string, id: string | number) => {
        if (resource === 'categories') return Promise.resolve(categories[String(id)]);
        return Promise.resolve(productWithCategory);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['getResource'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProduct(internalId);

      expect(result.categoryBreadcrumb).toEqual([
        { id: '5', name: 'Home & Garden' },
        { id: '12', name: 'Mugs' },
      ]);
    });

    it('leaves categoryBreadcrumb unset when no path resolver is wired (F3)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, id_category_default: '12' });

      const result = await adapter.getProduct(internalId);

      expect(result.categoryBreadcrumb).toBeUndefined();
    });
  });

  describe('getProducts', () => {
    it('should fetch and map multiple products', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2', reference: 'TEST-002' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([
        ['1:test-connection-id', 'internal-1'],
        ['2:test-connection-id', 'internal-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        {},
        undefined,
        undefined
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-1');
      expect(result[1].id).toBe('internal-2');
    });

    it('should return empty array when no products found', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      expect(result).toEqual([]);
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });

    it('should pass filters to HTTP client', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.getProducts({ status: 'active', limit: 50, offset: 100 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({
            active: 1,
          }),
        }),
        50,
        100
      );
    });

    it('should filter out products without internal ID mapping', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      // Only map first product
      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProducts();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('internal-1');
    });
  });

  describe('listExternalIds', () => {
    it('should return external ids as strings without creating mappings', async () => {
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValue([{ id: 1 }, { id: '2' }, { id: 3 }]);

      const result = await adapter.listExternalIds({ limit: 100, offset: 0 });

      expect(result).toEqual(['1', '2', '3']);
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        { display: '[id]' },
        100,
        0
      );
      // listExternalIds must NOT touch identifier mapping; creating mappings is the
      // downstream master.product.syncByExternalId handler's responsibility.
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });

    it('should skip entries without an id', async () => {
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValue([{ id: 7 }, { id: null }, { id: undefined }, { id: 9 }]);

      const result = await adapter.listExternalIds();

      expect(result).toEqual(['7', '9']);
    });

    it('should return empty array when the source is empty', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      const result = await adapter.listExternalIds({ limit: 50, offset: 0 });

      expect(result).toEqual([]);
    });
  });

  describe('getProductVariants', () => {
    it('should fetch and map product variants', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      const combinations: PrestashopCombination[] = [
        {
          id: '101',
          id_product: '42',
          reference: 'VAR-001',
          price: '5.00',
          quantity: '10',
        },
        {
          id: '102',
          id_product: '42',
          reference: 'VAR-002',
          price: '10.00',
          quantity: '20',
        },
      ];

      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);

      const idMap = new Map([
        ['101:test-connection-id', 'internal-variant-1'],
        ['102:test-connection-id', 'internal-variant-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProductVariants(productId);

      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalProductId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'combinations',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({
            id_product: externalProductId,
          }),
        })
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-variant-1');
      expect(result[1].id).toBe('internal-variant-2');
      expect(mockIdentifierMapping.deleteMapping).toHaveBeenCalledWith(
        'ProductVariant',
        `product:${externalProductId}`,
        connection.id
      );
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ entityType: 'ProductVariant', externalId: '101' }),
          expect.objectContaining({ entityType: 'ProductVariant', externalId: '102' }),
        ])
      );
    });

    it('resolves a combination price as base + impact (impact 0 when unset) (#1096)', async () => {
      const productId = 'internal-product-123';
      // Base product price is 19.99 (fixture). PrestaShop combination `price` is
      // an IMPACT, so absolute = 19.99 + impact; an unset impact yields the base.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId: '42', entityType: 'Product' }]);
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      const combinations: PrestashopCombination[] = [
        { id: '101', id_product: '42', reference: 'IMP-5', price: '5.00', quantity: '10' },
        { id: '102', id_product: '42', reference: 'NO-IMP', quantity: '20' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(
        new Map([
          ['101:test-connection-id', 'internal-variant-1'],
          ['102:test-connection-id', 'internal-variant-2'],
        ])
      );

      const result = await adapter.getProductVariants(productId);

      expect(result[0].price).toBe(24.99); // 19.99 + 5.00
      expect(result[1].price).toBe(19.99); // 19.99 + 0 (impact unset)
    });

    it('treats a non-positive absolute combination price as no-master-price (#1099 self-review)', async () => {
      const productId = 'internal-product-123';
      // Base 19.99; a negative impact larger than the base would yield a negative
      // absolute price — invalid, so the variant must surface no price at all
      // (the `no-master-price` blocker) rather than publishing a negative price.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId: '42', entityType: 'Product' }]);
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      const combinations: PrestashopCombination[] = [
        { id: '101', id_product: '42', reference: 'NEG', price: '-25.00', quantity: '10' },
      ];
      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest
        .fn()
        .mockResolvedValue(new Map([['101:test-connection-id', 'internal-variant-1']]));

      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].price).toBeUndefined();
    });

    it('does not fallback to product barcode when multiple combinations exist', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        ...samplePrestashopProduct,
        id: externalProductId,
        ean13: '5901234123457',
        upc: '012345678905',
      });

      const combinations: PrestashopCombination[] = [
        {
          id: '101',
          id_product: '42',
          reference: 'VAR-001',
        },
        {
          id: '102',
          id_product: '42',
          reference: 'VAR-002',
        },
      ];

      mockHttpClient.listResources = jest.fn().mockResolvedValue(combinations);

      const idMap = new Map([
        ['101:test-connection-id', 'internal-variant-1'],
        ['102:test-connection-id', 'internal-variant-2'],
      ]);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(2);
      expect(result[0].ean).toBeNull();
      expect(result[0].gtin).toBeNull();
      expect(result[1].ean).toBeNull();
      expect(result[1].gtin).toBeNull();
    });

    it('should return synthetic variant when no combinations found', async () => {
      const productId = 'internal-product-123';
      const externalProductId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe(samplePrestashopProduct.reference);
      // Synthetic variant inherits master price from the parent product so
      // simple products carry a usable price for the bulk wizard (#792).
      expect(result[0].price).toBe(19.99);
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'ProductVariant',
        `product:${externalProductId}`,
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({ synthetic: true }),
        })
      );
      // isVariant metadata shim is intentionally no longer written — entityType is authoritative.
      expect(mockIdentifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({ isVariant: expect.anything() }),
        })
      );
    });

    it.each([
      ['undefined price', undefined],
      ['null price', null],
      ['non-numeric price', 'not-a-number'],
    ])(
      'should leave synthetic variant price undefined when parent product has %s',
      async (_label, priceValue) => {
        const productId = 'internal-product-456';
        const externalProductId = '43';

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
          {
            connectionId: connection.id,
            externalId: externalProductId,
            entityType: 'Product',
          },
        ]);

        mockHttpClient.getResource = jest
          .fn()
          .mockResolvedValue({ ...samplePrestashopProduct, price: priceValue });
        mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

        const result = await adapter.getProductVariants(productId);

        expect(result).toHaveLength(1);
        // Surfaces as `no-master-price` blocker downstream in #792.
        expect(result[0].price).toBeUndefined();
      }
    );

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProductVariants(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });
  });

  describe('write operations (not supported)', () => {
    it('should throw PrestashopNotSupportedException for createProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.createProduct({ name: 'New Product' } as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for updateProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.updateProduct('product-id', { name: 'Updated' } as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for deleteProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.deleteProduct('product-id')).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for upsertProductVariant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- test mock: explicit any narrows the dynamic spy / fixture shape
      await expect(adapter.upsertProductVariant('product-id', {} as any)).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for assignCategories', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.assignCategories('product-id', ['cat-1'])).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });
  });

  describe('getProductCategories (#1502)', () => {
    const internalId = 'internal-product-123';
    const externalId = '42';

    function mapExternalId(): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockResolvedValue([{ connectionId: connection.id, externalId, entityType: 'Product' }]);
    }

    it('returns the product category tree root→leaf with depth when a path resolver is wired', async () => {
      mapExternalId();
      const productWithCategory: PrestashopProduct = {
        ...samplePrestashopProduct,
        id_category_default: '12',
      };
      const categories: Record<string, { id: string; name: string; id_parent: string }> = {
        '5': { id: '5', name: 'Home & Garden', id_parent: '2' },
        '12': { id: '12', name: 'Mugs', id_parent: '5' },
      };
      mockHttpClient.getResource = jest.fn((resource: string, id: string | number) => {
        if (resource === 'categories') return Promise.resolve(categories[String(id)]);
        return Promise.resolve(productWithCategory);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['getResource'];

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProductCategories(internalId);

      expect(result).toEqual([
        { id: '5', name: 'Home & Garden', depth: 0 },
        { id: '12', name: 'Mugs', depth: 1 },
      ]);
    });

    it('returns an empty list when the product has no default category (tolerated)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        ...samplePrestashopProduct,
        id_category_default: undefined,
      });

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver(),
        new PrestashopFeatureResolver(),
        new PrestashopCategoryPathResolver()
      );

      const result = await adapterWithResolver.getProductCategories(internalId);

      expect(result).toEqual([]);
    });

    it('returns an empty list when no path resolver is wired (tolerated)', async () => {
      mapExternalId();
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ ...samplePrestashopProduct, id_category_default: '12' });

      const result = await adapter.getProductCategories(internalId);

      expect(result).toEqual([]);
    });

    it('throws PrestashopResourceNotFoundException when no external ID mapping exists', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- test mock: narrowing dynamic spy / fixture / response shape
      await expect(adapter.getProductCategories(internalId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });
  });

  describe('searchProducts', () => {
    it('should delegate to getProducts with query filter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.searchProducts('test query', { status: 'active' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        expect.any(Object),
        undefined,
        undefined
      );
    });
  });

  describe('getProductVariants — semantic attributes (#1050)', () => {
    const externalProductId = '42';
    const productId = 'internal-product-123';
    const combinations: PrestashopCombination[] = [
      {
        id: '101',
        id_product: '42',
        reference: 'VAR-RED',
        associations: { product_option_values: [{ id: '20' }] },
      },
    ];
    const options = [{ id: '1', name: 'Color' }];
    const optionValues = [{ id: '20', name: 'Red', id_attribute_group: '1' }];

    function seedIdentifierMapping(): void {
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: externalProductId, entityType: 'Product' },
      ]);
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest
        .fn()
        .mockResolvedValue(new Map([['101:test-connection-id', 'internal-variant-1']]));
    }

    it('emits semantic { group: value } attributes when the resolver is wired', async () => {
      seedIdentifierMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'combinations') return Promise.resolve(combinations);
        if (resource === 'product_options') return Promise.resolve(options);
        if (resource === 'product_option_values') return Promise.resolve(optionValues);
        return Promise.resolve([]);
      }) as unknown as typeof mockHttpClient.listResources;

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver()
      );

      const result = await adapterWithResolver.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].attributes).toEqual({ Color: 'Red' });
    });

    it('falls back to positional attributes when the option fetch fails', async () => {
      seedIdentifierMapping();
      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'combinations') return Promise.resolve(combinations);
        return Promise.reject(new Error('options endpoint down'));
      }) as unknown as typeof mockHttpClient.listResources;

      const adapterWithResolver = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connection,
        new PrestashopAttributeResolver()
      );

      const result = await adapterWithResolver.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].attributes).toEqual({ option_0: '20' });
    });
  });
});

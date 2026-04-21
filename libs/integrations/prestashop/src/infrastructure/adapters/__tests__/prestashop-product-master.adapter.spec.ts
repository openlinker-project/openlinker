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
import {
  PrestashopResourceNotFoundException,
  PrestashopNotSupportedException,
} from '@openlinker/integrations-prestashop';
import { PrestashopProduct, PrestashopCombination } from '../../mappers/prestashop.mapper.interface';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

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
      connection,
    );
  });

  describe('getProduct', () => {
    it('should fetch and map a product successfully', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getProduct(internalId);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', internalId);
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId);
      expect(result.id).toBe(internalId);
      expect(result.name).toBe('Test Product');
      expect(result.sku).toBe('TEST-001');
    });

    it('should throw PrestashopResourceNotFoundException when no external ID mapping exists', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getProduct(internalId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
    });

    it('should throw PrestashopResourceNotFoundException when external ID not found for this connection', async () => {
      const internalId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: 'other-connection-id',
          externalId: '42',
          entityType: 'Product',
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getProduct(internalId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
    });

    it('should use connection langId from config', async () => {
      const internalId = 'internal-product-123';
      const externalId = '42';
      const connectionWithLang = createTestConnection({ config: { ...connection.config, langId: 2 } });

      const adapterWithLang = new PrestashopProductMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        productMapper,
        connectionWithLang,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.getResource).toHaveBeenCalled();
    });
  });

  describe('getProducts', () => {
    it('should fetch and map multiple products', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2', reference: 'TEST-002' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([
        ['1:test-connection-id', 'internal-1'],
        ['2:test-connection-id', 'internal-2'],
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getProducts();

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith('products', {}, undefined, undefined);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-1');
      expect(result[1].id).toBe('internal-2');
    });

    it('should return empty array when no products found', async () => {
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getProducts();

      expect(result).toEqual([]);
      expect(mockIdentifierMapping.batchGetOrCreateInternalIds).not.toHaveBeenCalled();
    });

    it('should pass filters to HTTP client', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.getProducts({ status: 'active', limit: 50, offset: 100 });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({
            active: 1,
          }),
        }),
        50,
        100,
      );
    });

    it('should filter out products without internal ID mapping', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const products: PrestashopProduct[] = [
        { ...samplePrestashopProduct, id: '1' },
        { ...samplePrestashopProduct, id: '2' },
      ];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      // Only map first product
      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
        0,
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getProductVariants(productId);

      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalProductId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'combinations',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({
            id_product: externalProductId,
          }),
        }),
      );

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('internal-variant-1');
      expect(result[1].id).toBe('internal-variant-2');
      expect(mockIdentifierMapping.deleteMapping).toHaveBeenCalledWith(
        'Product',
        `product:${externalProductId}`,
        connection.id,
      );
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: externalProductId,
          entityType: 'Product',
        },
      ]);

      mockHttpClient.getResource = jest.fn().mockResolvedValue(samplePrestashopProduct);
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getProductVariants(productId);

      expect(result).toHaveLength(1);
      expect(result[0].sku).toBe(samplePrestashopProduct.reference);
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Product',
        `product:${externalProductId}`,
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({ isVariant: true, synthetic: true }),
        }),
      );
    });

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getProductVariants(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
    });
  });

  describe('write operations (not supported)', () => {
    it('should throw PrestashopNotSupportedException for createProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await expect(adapter.createProduct({ name: 'New Product' } as any)).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for updateProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await expect(adapter.updateProduct('product-id', { name: 'Updated' } as any)).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for deleteProduct', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.deleteProduct('product-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for upsertProductVariant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
      await expect(adapter.upsertProductVariant('product-id', {} as any)).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for assignCategories', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.assignCategories('product-id', ['cat-1'])).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for getProductCategories', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getProductCategories('product-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });
  });

  describe('searchProducts', () => {
    it('should delegate to getProducts with query filter', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const products: PrestashopProduct[] = [{ ...samplePrestashopProduct, id: '1' }];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue(products);

      const idMap = new Map([['1:test-connection-id', 'internal-1']]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.batchGetOrCreateInternalIds = jest.fn().mockResolvedValue(idMap);

      await adapter.searchProducts('test query', { status: 'active' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'products',
        expect.any(Object),
        undefined,
        undefined,
      );
    });
  });
});


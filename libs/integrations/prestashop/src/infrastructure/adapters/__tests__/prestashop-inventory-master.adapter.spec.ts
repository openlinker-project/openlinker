/**
 * PrestaShop Inventory Master Adapter Tests
 *
 * Unit tests for PrestashopInventoryMasterAdapter. Tests inventory fetching,
 * identifier mapping, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopInventoryMasterAdapter } from '../prestashop-inventory-master.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopInventoryMapper } from '../../mappers/prestashop-inventory.mapper';
import {
  PrestashopResourceNotFoundException,
  PrestashopNotSupportedException,
} from '@openlinker/integrations-prestashop';
import type { PrestashopStockAvailable } from '../../mappers/prestashop.mapper.interface';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

describe('PrestashopInventoryMasterAdapter', () => {
  let adapter: PrestashopInventoryMasterAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let connection: ReturnType<typeof createTestConnection>;
  let inventoryMapper: PrestashopInventoryMapper;

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockIdentifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    inventoryMapper = new PrestashopInventoryMapper();

    adapter = new PrestashopInventoryMasterAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      inventoryMapper,
      connection
    );
  });

  describe('getInventory', () => {
    it('should fetch and map inventory successfully', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockResolvedValue('internal-inventory-123');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      const result = await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', productId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({
            id_product: externalProductId,
            id_product_attribute: 0,
          }),
        })
      );
      expect(result.productId).toBe(productId);
      expect(result.quantity).toBe(50);
    });

    it('should strip product: prefix from synthetic variant externalId before querying stock_availables', async () => {
      const productId = 'internal-product-123';
      // Simple products store a synthetic externalId of the form `product:<numericId>`
      const syntheticExternalId = 'product:42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: syntheticExternalId,
          entityType: 'Product',
        },
      ]);

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '75',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockResolvedValue('internal-inventory-123');

      const result = await adapter.getInventory(productId);

      // Adapter must send the plain numeric ID, not `product:42`
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({ id_product: '42' }),
        })
      );
      expect(result.quantity).toBe(75);
    });

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });

    it('should fetch inventory for combination product via id_product_attribute fallback', async () => {
      const productId = 'internal-product-456';
      const combinationExternalId = '15';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: combinationExternalId,
          entityType: 'Product',
        },
      ]);

      const combinationStockRecord: PrestashopStockAvailable = {
        id: '201',
        id_product: '38',
        id_product_attribute: '15',
        quantity: '30',
        out_of_stock: '0',
      };

      // First call (id_product_attribute=0) returns empty; second call returns combination stock
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([combinationStockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockResolvedValue('internal-inventory-456');

      const result = await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenNthCalledWith(
        2,
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
          custom: expect.objectContaining({ id_product_attribute: combinationExternalId }),
        })
      );
      expect(result.quantity).toBe(30);
    });

    it('should throw PrestashopResourceNotFoundException when both product-level and combination-level queries return empty', async () => {
      const productId = 'internal-product-789';
      const externalId = '99';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should throw PrestashopResourceNotFoundException when no stock record found', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
      // Both the product-level and combination-level queries must be attempted
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should create internal ID for inventory with parent context', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockResolvedValue('internal-inventory-123');

      await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Inventory',
        '101',
        connection.id,
        expect.objectContaining({
          parentEntityType: 'Product',
          parentInternalId: productId,
        })
      );
    });
  });

  describe('listInventory', () => {
    it('returns one variant-keyed Inventory per combination and ignores the product-level aggregate', async () => {
      const productId = 'internal-product-456';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '38', entityType: 'Product' },
      ]);

      const aggregateRow: PrestashopStockAvailable = {
        id: '200',
        id_product: '38',
        id_product_attribute: '0',
        quantity: '30',
        out_of_stock: '0',
      };
      const combo15: PrestashopStockAvailable = {
        id: '201',
        id_product: '38',
        id_product_attribute: '15',
        quantity: '10',
        out_of_stock: '0',
      };
      const combo16: PrestashopStockAvailable = {
        id: '202',
        id_product: '38',
        id_product_attribute: '16',
        quantity: '20',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValue([aggregateRow, combo15, combo16]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockImplementation((entityType: string, externalId: string) =>
          Promise.resolve(`${entityType}:${externalId}`)
        );

      const result = await adapter.listInventory(productId);

      // One entry per combination — the id_product_attribute=0 aggregate is ignored.
      expect(result).toHaveLength(2);
      expect(result.map((i) => i.variantId)).toEqual(['ProductVariant:15', 'ProductVariant:16']);
      expect(result.map((i) => i.quantity)).toEqual([10, 20]);
      // Single stock_availables call scoped by id_product (all rows in one fetch).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        expect.objectContaining({ custom: { id_product: '38' } })
      );
      // Combination ids resolve under entityType='ProductVariant'.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'ProductVariant',
        '15',
        connection.id,
        expect.objectContaining({ parentInternalId: productId })
      );
    });

    it('maps the single aggregate row to the synthetic variant for a simple product', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);

      const aggregateRow: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([aggregateRow]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockImplementation((entityType: string, externalId: string) =>
          Promise.resolve(`${entityType}:${externalId}`)
        );

      const result = await adapter.listInventory(productId);

      expect(result).toHaveLength(1);
      expect(result[0].variantId).toBe('ProductVariant:product:42');
      expect(result[0].quantity).toBe(50);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'ProductVariant',
        'product:42',
        connection.id,
        expect.objectContaining({ parentInternalId: productId })
      );
    });

    it('throws PrestashopResourceNotFoundException when the product has no external mapping', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      await expect(adapter.listInventory('internal-product-x')).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });

    it('throws PrestashopResourceNotFoundException when no stock rows exist', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await expect(adapter.listInventory('internal-product-123')).rejects.toThrow(
        PrestashopResourceNotFoundException
      );
    });
  });

  describe('getAvailableQuantity', () => {
    it('should return available quantity from inventory', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockResolvedValue('internal-inventory-123');

      const result = await adapter.getAvailableQuantity(productId);

      expect(result).toBe(50);
    });
  });

  describe('write operations (not supported)', () => {
    it('should throw PrestashopNotSupportedException for adjustInventory', async () => {
      await expect(
        adapter.adjustInventory({
          productId: 'product-id',
          quantity: 10,
          reason: 'test',
        })
      ).rejects.toThrow(PrestashopNotSupportedException);
    });

    it('should throw PrestashopNotSupportedException for reserveInventory', async () => {
      await expect(adapter.reserveInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });

    it('should throw PrestashopNotSupportedException for releaseInventory', async () => {
      await expect(adapter.releaseInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException
      );
    });
  });
});

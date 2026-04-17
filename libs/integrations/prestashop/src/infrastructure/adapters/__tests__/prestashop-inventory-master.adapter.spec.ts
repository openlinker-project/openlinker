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
import { PrestashopStockAvailable } from '../../mappers/prestashop.mapper.interface';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';

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
      connection,
    );
  });

  describe('getInventory', () => {
    it('should fetch and map inventory successfully', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inventory-123');

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const result = await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', productId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({
            id_product: externalProductId,
            id_product_attribute: 0,
          }),
        }),
      );
      expect(result.productId).toBe(productId);
      expect(result.quantity).toBe(50);
    });

    it('should strip product: prefix from synthetic variant externalId before querying stock_availables', async () => {
      const productId = 'internal-product-123';
      // Simple products store a synthetic externalId of the form `product:<numericId>`
      const syntheticExternalId = 'product:42';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inventory-123');

      const result = await adapter.getInventory(productId);

      // Adapter must send the plain numeric ID, not `product:42`
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({ id_product: '42' }),
        }),
      );
      expect(result.quantity).toBe(75);
    });

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
    });

    it('should fetch inventory for combination product via id_product_attribute fallback', async () => {
      const productId = 'internal-product-456';
      const combinationExternalId = '15';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([combinationStockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inventory-456');

      const result = await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenNthCalledWith(
        2,
        'stock_availables',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        expect.objectContaining({
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          custom: expect.objectContaining({ id_product_attribute: combinationExternalId }),
        }),
      );
      expect(result.quantity).toBe(30);
    });

    it('should throw PrestashopResourceNotFoundException when both product-level and combination-level queries return empty', async () => {
      const productId = 'internal-product-789';
      const externalId = '99';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId,
          entityType: 'Product',
        },
      ]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should throw PrestashopResourceNotFoundException when no stock record found', async () => {
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
      // Both the product-level and combination-level queries must be attempted
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
    });

    it('should create internal ID for inventory with parent context', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inventory-123');

      await adapter.getInventory(productId);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Inventory',
        '101',
        connection.id,
        expect.objectContaining({
          parentEntityType: 'Product',
          parentInternalId: productId,
        }),
      );
    });
  });

  describe('getAvailableQuantity', () => {
    it('should return available quantity from inventory', async () => {
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

      const stockRecord: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockHttpClient.listResources = jest.fn().mockResolvedValue([stockRecord]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inventory-123');

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
        }),
      ).rejects.toThrow(PrestashopNotSupportedException);
    });

    it('should throw PrestashopNotSupportedException for reserveInventory', async () => {
      await expect(adapter.reserveInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for releaseInventory', async () => {
      await expect(adapter.releaseInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });
  });
});


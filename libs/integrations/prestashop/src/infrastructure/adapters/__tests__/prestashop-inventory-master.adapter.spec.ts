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

    it('should throw PrestashopResourceNotFoundException when product not found', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.getInventory(productId)).rejects.toThrow(
        PrestashopResourceNotFoundException,
      );
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      ).rejects.toThrow(PrestashopNotSupportedException);
    });

    it('should throw PrestashopNotSupportedException for reserveInventory', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.reserveInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });

    it('should throw PrestashopNotSupportedException for releaseInventory', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      await expect(adapter.releaseInventory('product-id', 5, 'order-id')).rejects.toThrow(
        PrestashopNotSupportedException,
      );
    });
  });
});


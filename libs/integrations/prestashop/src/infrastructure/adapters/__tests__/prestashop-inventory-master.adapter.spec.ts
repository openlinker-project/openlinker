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
  PrestashopNotSupportedException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import { MasterProductNotFoundError } from '@openlinker/core/products';
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

    it('should NOT classify a missing external mapping as a master deletion (#1688)', async () => {
      const productId = 'internal-product-123';

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      const rejection = adapter.getInventory(productId);
      await expect(rejection).rejects.toBeInstanceOf(PrestashopResourceNotFoundException);
      // A mapping gap is retryable/diagnosable, not "deleted at the master" -
      // classifying it as a deletion would stale a live product's inventory.
      await expect(rejection).rejects.not.toBeInstanceOf(MasterProductNotFoundError);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).not.toHaveBeenCalled();
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

    it('should throw MasterProductNotFoundError when no stock rows exist and the product itself is gone (#1688)', async () => {
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
      // The product probe is the real deletion signal: it 404s.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValue(new PrestashopResourceNotFoundException('gone', 'Product', externalId));

      await expect(adapter.getInventory(productId)).rejects.toThrow(MasterProductNotFoundError);
      // Both the product-level and combination-level queries must be attempted
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(2);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockHttpClient.getResource).toHaveBeenCalledWith('products', externalId);
    });

    it('should NOT classify zero stock rows as a master deletion when the product still resolves (#1688)', async () => {
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
      // Product probe resolves — zero stock rows is a data gap, not a deletion.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue({ id: externalProductId });

      const rejection = adapter.getInventory(productId);
      await expect(rejection).rejects.toBeInstanceOf(PrestashopResourceNotFoundException);
      await expect(rejection).rejects.not.toBeInstanceOf(MasterProductNotFoundError);
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

    it('does NOT classify a missing external mapping as a master deletion (#1688)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      const rejection = adapter.listInventory('internal-product-x');
      await expect(rejection).rejects.toBeInstanceOf(PrestashopResourceNotFoundException);
      await expect(rejection).rejects.not.toBeInstanceOf(MasterProductNotFoundError);
    });

    it('throws MasterProductNotFoundError when no stock rows exist and the product is gone (#1688)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValue(new PrestashopResourceNotFoundException('gone', 'Product', '42'));

      await expect(adapter.listInventory('internal-product-123')).rejects.toThrow(
        MasterProductNotFoundError
      );
    });

    it('does NOT classify zero stock rows as a master deletion when the product still resolves (#1688)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue({ id: '42' });

      const rejection = adapter.listInventory('internal-product-123');
      await expect(rejection).rejects.toBeInstanceOf(PrestashopResourceNotFoundException);
      await expect(rejection).rejects.not.toBeInstanceOf(MasterProductNotFoundError);
    });

    it('translates a platform not-found raised by the stock_availables read to MasterProductNotFoundError (#1688)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);
      const platformError = new PrestashopResourceNotFoundException('gone', 'Inventory', '42');
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockRejectedValue(platformError);

      // The neutral error carries the internal product id, the connection it was
      // raised for, and the platform error as its cause — a consumer can trace
      // back to the originating platform failure without a platform import.
      await expect(adapter.listInventory('internal-product-123')).rejects.toMatchObject({
        name: 'MasterProductNotFoundError',
        productId: 'internal-product-123',
        connectionId: connection.id,
        cause: platformError,
      });
      await expect(adapter.listInventory('internal-product-123')).rejects.toBeInstanceOf(
        MasterProductNotFoundError
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

  describe('adjustInventory', () => {
    const PRODUCT_ID = 'internal-product-123';
    const PS_PRODUCT_ID = '42';

    /** One simple-product stock row: no combinations, not ASM, single shop. */
    function simpleStockRow(quantity: string | number = 10): PrestashopStockAvailable {
      return {
        id: '101',
        id_product: PS_PRODUCT_ID,
        id_product_attribute: '0',
        quantity,
        depends_on_stock: '0',
        id_shop: '1',
      };
    }

    function mapProductToPrestashop(): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: connection.id,
          externalId: PS_PRODUCT_ID,
          entityType: 'Product',
        },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-inv-1');
    }

    /**
     * The adapter issues two reads on the no-variant path: the combination
     * probe (all rows for the product) and the targeted row read. Both hit the
     * same `listResources` mock, so the fixture answers both with the same set.
     */
    function respondWithRows(rows: PrestashopStockAvailable[]): void {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.listResources = jest.fn().mockResolvedValue(rows);
    }

    beforeEach(() => {
      mapProductToPrestashop();
    });

    it('should raise the quantity by exactly n and PUT the full row with quantity overlaid', async () => {
      respondWithRows([simpleStockRow(10)]);

      const result = await adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 3 });

      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'stock_availables',
        '101',
        expect.objectContaining({
          id: '101',
          id_product: PS_PRODUCT_ID,
          id_product_attribute: '0',
          quantity: '13',
          // Preserved from the read-back row rather than dropped to PS defaults.
          depends_on_stock: '0',
          id_shop: '1',
        })
      );
      expect(result.adjustmentOutcome).toEqual({
        disposition: 'applied',
        idempotency: 'not_requested',
        appliedAt: null,
      });
    });

    it('should clamp at zero when a decrement exceeds current stock', async () => {
      respondWithRows([simpleStockRow(3)]);

      await adapter.adjustInventory({ productId: PRODUCT_ID, quantity: -5 });

      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'stock_availables',
        '101',
        expect.objectContaining({ quantity: '0' })
      );
    });

    it('should report appliedAt as null because PrestaShop reports no instant', async () => {
      respondWithRows([simpleStockRow(10)]);

      const result = await adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 1 });

      // stock_availables carries no timestamp column; OL must not invent one.
      expect(result.adjustmentOutcome?.appliedAt).toBeNull();
    });

    it('should target the combination row when variantId names one', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string) =>
          entityType === 'ProductVariant'
            ? Promise.resolve([
                { connectionId: connection.id, externalId: '77', entityType: 'ProductVariant' },
              ])
            : Promise.resolve([
                { connectionId: connection.id, externalId: PS_PRODUCT_ID, entityType: 'Product' },
              ])
        );
      respondWithRows([
        { ...simpleStockRow(4), id: '202', id_product_attribute: '77' },
      ]);

      await adapter.adjustInventory({
        productId: PRODUCT_ID,
        variantId: 'internal-variant-1',
        quantity: 2,
      });

      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        expect.objectContaining({
          custom: { id_product: PS_PRODUCT_ID, id_product_attribute: '77' },
        })
      );
      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'stock_availables',
        '202',
        expect.objectContaining({ quantity: '6' })
      );
    });

    it('should target the product-level row for a synthetic product: variant', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string) =>
          entityType === 'ProductVariant'
            ? Promise.resolve([
                {
                  connectionId: connection.id,
                  externalId: `product:${PS_PRODUCT_ID}`,
                  entityType: 'ProductVariant',
                },
              ])
            : Promise.resolve([
                { connectionId: connection.id, externalId: PS_PRODUCT_ID, entityType: 'Product' },
              ])
        );
      respondWithRows([simpleStockRow(10)]);

      await adapter.adjustInventory({
        productId: PRODUCT_ID,
        variantId: 'internal-variant-simple',
        quantity: 1,
      });

      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'stock_availables',
        expect.objectContaining({
          custom: { id_product: PS_PRODUCT_ID, id_product_attribute: '0' },
        })
      );
    });

    describe('refusals', () => {
      it('should refuse and name shopId when several shops match the row', async () => {
        respondWithRows([
          { ...simpleStockRow(10), id: '101', id_shop: '1' },
          { ...simpleStockRow(4), id: '102', id_shop: '2' },
        ]);

        await expect(
          adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 3 })
        ).rejects.toThrow(/shopId/);
        expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      });

      it('should refuse when advanced stock management owns the quantity', async () => {
        respondWithRows([{ ...simpleStockRow(10), depends_on_stock: '1' }]);

        await expect(
          adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 3 })
        ).rejects.toThrow(PrestashopNotSupportedException);
        expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      });

      it('should refuse when a combination product is adjusted without a variantId', async () => {
        respondWithRows([
          simpleStockRow(10),
          { ...simpleStockRow(4), id: '202', id_product_attribute: '77' },
        ]);

        await expect(
          adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 3 })
        ).rejects.toThrow(PrestashopNotSupportedException);
        expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      });

      it('should refuse rather than treat an unreadable quantity as zero', async () => {
        respondWithRows([simpleStockRow('not-a-number')]);

        await expect(
          adapter.adjustInventory({ productId: PRODUCT_ID, quantity: 3 })
        ).rejects.toThrow(PrestashopNotSupportedException);
        // A 0 baseline would have written the delta alone over the real stock.
        expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      });

      it('should raise the platform exception for a variant mapping gap, not a master deletion', async () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        mockIdentifierMapping.getExternalIds = jest
          .fn()
          .mockImplementation((entityType: string) =>
            entityType === 'ProductVariant'
              ? Promise.resolve([])
              : Promise.resolve([
                  { connectionId: connection.id, externalId: PS_PRODUCT_ID, entityType: 'Product' },
                ])
          );

        await expect(
          adapter.adjustInventory({
            productId: PRODUCT_ID,
            variantId: 'unmapped-variant',
            quantity: 3,
          })
        ).rejects.toThrow(PrestashopResourceNotFoundException);
      });
    });

    describe('idempotency', () => {
      let cache: { get: jest.Mock; set: jest.Mock; delete: jest.Mock };

      function adapterWithCache(): PrestashopInventoryMasterAdapter {
        return new PrestashopInventoryMasterAdapter(
          mockHttpClient,
          mockIdentifierMapping,
          inventoryMapper,
          connection,
          cache
        );
      }

      beforeEach(() => {
        cache = { get: jest.fn().mockResolvedValue(null), set: jest.fn(), delete: jest.fn() };
        respondWithRows([simpleStockRow(10)]);
      });

      it('should report not_requested when no key is supplied', async () => {
        const result = await adapterWithCache().adjustInventory({
          productId: PRODUCT_ID,
          quantity: 1,
        });

        expect(result.adjustmentOutcome?.idempotency).toBe('not_requested');
        expect(cache.get).not.toHaveBeenCalled();
      });

      it('should apply and report unsupported when a key is supplied but no cache is wired', async () => {
        // `adapter` is the no-cache instance from the outer beforeEach.
        const result = await adapter.adjustInventory({
          productId: PRODUCT_ID,
          quantity: 1,
          idempotencyKey: 'return:r1:l1:1',
        });

        expect(result.adjustmentOutcome?.idempotency).toBe('unsupported');
        expect(result.adjustmentOutcome?.disposition).toBe('applied');
        expect(mockHttpClient.updateResource).toHaveBeenCalled();
      });

      it('should record the applied key only after the write succeeds', async () => {
        await adapterWithCache().adjustInventory({
          productId: PRODUCT_ID,
          quantity: 1,
          idempotencyKey: 'return:r1:l1:1',
        });

        expect(cache.set).toHaveBeenCalledWith(
          `ps:inventory-adjust:${connection.id}:return:r1:l1:1`,
          true,
          7 * 24 * 60 * 60
        );
      });

      it('should NOT record the applied key when the write fails', async () => {
        mockHttpClient.updateResource = jest.fn().mockRejectedValue(new Error('PS 500'));

        await expect(
          adapterWithCache().adjustInventory({
            productId: PRODUCT_ID,
            quantity: 1,
            idempotencyKey: 'return:r1:l1:1',
          })
        ).rejects.toThrow('PS 500');

        // Recording first would suppress the retry of an adjustment that never landed.
        expect(cache.set).not.toHaveBeenCalled();
      });

      it('should not double-apply a repeated key, and return current stock rather than a replay', async () => {
        cache.get = jest.fn().mockResolvedValue(true);
        respondWithRows([simpleStockRow(13)]);

        const result = await adapterWithCache().adjustInventory({
          productId: PRODUCT_ID,
          quantity: 3,
          idempotencyKey: 'return:r1:l1:1',
        });

        expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
        expect(result.adjustmentOutcome).toEqual({
          disposition: 'deduplicated',
          idempotency: 'honoured',
          appliedAt: null,
        });
        // The master's CURRENT figure, not 13 + 3.
        expect(result.quantity).toBe(13);
      });
    });
  });

  describe('write operations (not supported)', () => {
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

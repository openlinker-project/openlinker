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


  describe('listInventory - packs (#2598)', () => {
    const productId = 'internal-product-pack';

    /**
     * PrestaShop answers the pack's own stock read and the components' stock
     * read through the same resource, so the mock dispatches on the filter the
     * adapter sent.
     */
    function stockRouter(
      ownRows: PrestashopStockAvailable[],
      componentRows: PrestashopStockAvailable[],
      shopDefault?: string
    ): jest.Mock {
      return jest.fn((resource: string, filters: { custom?: Record<string, unknown> }) => {
        if (resource === 'configurations') {
          return Promise.resolve(shopDefault === undefined ? [] : [{ value: shopDefault }]);
        }
        const idProduct = String(filters?.custom?.id_product ?? '');
        return Promise.resolve(idProduct === '42' ? ownRows : componentRows);
      });
    }

    /** The router's recorded calls, typed so a spec can read the filter back. */
    function stockCalls(
      mock: jest.Mock
    ): Array<[string, { custom?: Record<string, unknown> } | undefined]> {
      return mock.mock.calls as Array<[string, { custom?: Record<string, unknown> } | undefined]>;
    }

    function packProduct(packStockType: string): Record<string, unknown> {
      return {
        id: '42',
        cache_is_pack: '1',
        pack_stock_type: packStockType,
        associations: {
          product_bundle: [
            { id: '11', id_product_attribute: '0', quantity: '2' },
            { id: '12', id_product_attribute: '0', quantity: '1' },
          ],
        },
      };
    }

    const ownRow: PrestashopStockAvailable = {
      id: '101',
      id_product: '42',
      id_product_attribute: '0',
      quantity: '99',
      out_of_stock: '0',
    };

    const componentRows: PrestashopStockAvailable[] = [
      { id: '201', id_product: '11', id_product_attribute: '0', quantity: '7' },
      { id: '202', id_product: '12', id_product_attribute: '0', quantity: '5' },
    ];

    beforeEach(() => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        { connectionId: connection.id, externalId: '42', entityType: 'Product' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockIdentifierMapping.getOrCreateInternalId = jest
        .fn()
        .mockImplementation((entityType: string, externalId: string) =>
          Promise.resolve(`${entityType}:${externalId}`)
        );
    });

    it('reports the minimum implied by the components, not the pack own stock row', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], componentRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      const result = await adapter.listInventory(productId);

      // 7 units of a component consumed 2 at a time allow 3 packs; the other
      // component allows 5. The pack own row claims 99 and is ignored.
      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(3);
      expect(result[0].available).toBe(3);
      expect(result[0].variantId).toBe('ProductVariant:product:42');
    });

    it('reads component stock for the whole bundle in one request', async () => {
      const listResources = stockRouter([ownRow], componentRows);
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      await adapter.listInventory(productId);

      const componentCalls = stockCalls(listResources).filter(
        (call) => String(call[1]?.custom?.id_product) === '11|12'
      );
      expect(componentCalls).toHaveLength(1);
      expect(listResources).toHaveBeenCalledTimes(2);
    });

    it('resolves pack_stock_type = 3 to the shop default before deriving', async () => {
      const listResources = stockRouter([ownRow], componentRows, '1');
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('3'));

      const result = await adapter.listInventory(productId);

      expect(listResources).toHaveBeenCalledWith(
        'configurations',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({ custom: { name: 'PS_PACK_STOCK_TYPE' } })
      );
      // The sentinel resolved to "decrement components", so the derived 3 wins.
      expect(result[0].quantity).toBe(3);
    });

    it('reads the shop default once per adapter instance', async () => {
      const listResources = stockRouter([ownRow], componentRows, '1');
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('3'));

      await adapter.listInventory(productId);
      await adapter.listInventory(productId);

      const configCalls = stockCalls(listResources).filter((call) => call[0] === 'configurations');
      expect(configCalls).toHaveLength(1);
    });

    it('takes the lower of own row and components when the shop decrements both', async () => {
      mockHttpClient.listResources = stockRouter(
        [{ ...ownRow, quantity: '2' }],
        componentRows,
        undefined
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('2'));

      const result = await adapter.listInventory(productId);

      // Components allow 3, the pack own row says 2.
      expect(result[0].quantity).toBe(2);
    });

    it('keeps the pack own stock row when the shop decrements the pack itself', async () => {
      const listResources = stockRouter([ownRow], componentRows);
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('0'));

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(99);
      // No component read: mode 0 makes the own row authoritative.
      expect(listResources).toHaveBeenCalledTimes(1);
    });

    it('does not mistake a pack with no stock rows of its own for a deleted product', async () => {
      mockHttpClient.listResources = stockRouter([], componentRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      const result = await adapter.listInventory(productId);

      expect(result).toHaveLength(1);
      expect(result[0].quantity).toBe(3);
      // The Inventory identifier is deterministic when there is no row to key on.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- test mock: narrowing dynamic spy / fixture / response shape
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Inventory',
        'pack:42',
        connection.id,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
        expect.objectContaining({ parentInternalId: productId })
      );
    });

    it('falls back to the pack own stock row when the pack declares no components', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], []);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: '42', cache_is_pack: '1', pack_stock_type: '1' });

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(99);
    });

    it('still reports zero when the components say zero', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], [
        { id: '201', id_product: '11', id_product_attribute: '0', quantity: '0' },
        { id: '202', id_product: '12', id_product_attribute: '0', quantity: '5' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(0);
    });

    it('leaves an ordinary product reporting exactly what the master says', async () => {
      const listResources = stockRouter([{ ...ownRow, quantity: '0' }], componentRows);
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: '42', cache_is_pack: '0', pack_stock_type: '3' });

      const result = await adapter.listInventory(productId);

      // Master is authoritative including zero: no component data may lift it.
      expect(result[0].quantity).toBe(0);
      expect(listResources).toHaveBeenCalledTimes(1);
    });

    it('degrades to the pack own stock row when the product probe fails', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], componentRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockRejectedValue(new Error('boom'));

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(99);
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

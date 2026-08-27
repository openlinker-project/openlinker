/**
 * PrestaShop Inventory Master Adapter Tests
 *
 * Unit tests for PrestashopInventoryMasterAdapter. Tests inventory fetching,
 * identifier mapping, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopTruncatedReadException } from '../../../domain/exceptions/prestashop-truncated-read.exception';
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
import { PrestashopPackResolver } from '../../provisioners/prestashop-pack.resolver';
import { PrestashopPackFilterIgnoredException } from '../../../domain/exceptions/prestashop-pack-filter-ignored.exception';

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
        }),
        100,
        0
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
        }),
        100,
        0
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
        }),
        100,
        0
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
        expect.objectContaining({ custom: { id_product: '38' } }),
        100,
        0
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
    let packResolver: PrestashopPackResolver;

    /**
     * PrestaShop answers the pack-id enumeration, the pack's own stock read and
     * the components' stock read through the same client method, so the mock
     * dispatches on the resource and the filter the adapter sent.
     *
     * `packIdPages` lets a spec answer the enumeration with more than one page.
     */
    function stockRouter(
      ownRows: PrestashopStockAvailable[],
      componentRows: PrestashopStockAvailable[],
      shopDefault?: string,
      packIdPages?: Array<Array<{ id: string }>>
    ): jest.Mock {
      const pages = packIdPages ?? [[{ id: '42' }]];
      return jest.fn(
        (
          resource: string,
          filters: { custom?: Record<string, unknown> },
          _limit?: number,
          offset?: number
        ) => {
          if (resource === 'configurations') {
            return Promise.resolve(shopDefault === undefined ? [] : [{ value: shopDefault }]);
          }
          if (resource === 'products') {
            const pageIndex = Math.floor((offset ?? 0) / 100);
            return Promise.resolve(pages[pageIndex] ?? []);
          }
          const idProduct = String(filters?.custom?.id_product ?? '');
          return Promise.resolve(idProduct === '42' ? ownRows : componentRows);
        }
      );
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
      packResolver = new PrestashopPackResolver();
      adapter = new PrestashopInventoryMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        inventoryMapper,
        connection,
        packResolver
      );
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
      // One pack-id enumeration, one own-row read, one component read.
      expect(listResources).toHaveBeenCalledTimes(3);
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
        expect.objectContaining({ custom: { name: 'PS_PACK_STOCK_TYPE' } }),
        1,
        0
      );
      // The sentinel resolved to "decrement components", so the derived 3 wins.
      expect(result[0].quantity).toBe(3);
    });

    it('reads the shop default and the pack ids once per connection, across adapter instances', async () => {
      const listResources = stockRouter([ownRow], componentRows, '1');
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('3'));

      // Master inventory sync builds one adapter per product, which is why the
      // caches live on the shared resolver and not on the adapter.
      await adapter.listInventory(productId);
      await new PrestashopInventoryMasterAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        inventoryMapper,
        connection,
        packResolver
      ).listInventory(productId);

      const calls = stockCalls(listResources);
      expect(calls.filter((call) => call[0] === 'configurations')).toHaveLength(1);
      expect(calls.filter((call) => call[0] === 'products')).toHaveLength(1);
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
      // `pack_stock_type = 0` on the product defers to the shop setting, which
      // PHP's `empty(0)` makes true in PrestaShop's own `Pack::getQuantity`.
      const listResources = stockRouter([ownRow], componentRows, '0');
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('0'));

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(99);
      // No component read: the resolved mode makes the own row authoritative.
      const componentCalls = stockCalls(listResources).filter(
        (call) => String(call[1]?.custom?.id_product) === '11|12'
      );
      expect(componentCalls).toHaveLength(0);
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
      // Not in the shop's pack set, so nothing here may touch its quantity.
      const listResources = stockRouter([{ ...ownRow, quantity: '0' }], componentRows, undefined, [
        [],
      ]);
      mockHttpClient.listResources = listResources;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: '42', cache_is_pack: '0', pack_stock_type: '3' });

      const result = await adapter.listInventory(productId);

      // Master is authoritative including zero: no component data may lift it.
      expect(result[0].quantity).toBe(0);
      // One own-row read plus the shared pack-id enumeration. No product probe.
      expect(listResources).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
    });

    it('does not report zero when the component stock rows span more than one page', async () => {
      // The false zero this feature nearly shipped: the component read used to
      // stop at 100 rows, absent rows counted as 0, and a live pack published 0.
      const firstPage: PrestashopStockAvailable[] = Array.from({ length: 100 }, (_, index) => ({
        id: String(300 + index),
        id_product: '11',
        id_product_attribute: String(index + 1),
        quantity: '7',
      }));
      // The component the pack is actually short of only appears on page two.
      const secondPage: PrestashopStockAvailable[] = [
        { id: '201', id_product: '11', id_product_attribute: '0', quantity: '7' },
        { id: '202', id_product: '12', id_product_attribute: '0', quantity: '5' },
      ];
      mockHttpClient.listResources = jest.fn(
        (
          resource: string,
          filters: { custom?: Record<string, unknown> },
          _limit?: number,
          offset?: number
        ) => {
          if (resource === 'configurations') {
            return Promise.resolve([]);
          }
          if (resource === 'products') {
            return Promise.resolve((offset ?? 0) === 0 ? [{ id: '42' }] : []);
          }
          if (String(filters?.custom?.id_product) === '42') {
            return Promise.resolve([ownRow]);
          }
          return Promise.resolve((offset ?? 0) === 0 ? firstPage : secondPage);
        }
      ) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      const result = await adapter.listInventory(productId);

      expect(result[0].quantity).toBe(3);
    });

    it('propagates a component read failure instead of publishing the pack own row', async () => {
      // The counterpart of the deliberately swallowed product probe: a component
      // quantity we could not read is not a quantity, so the job must retry
      // rather than publish the pack's untouched own row of 99.
      mockHttpClient.listResources = jest.fn(
        (resource: string, filters: { custom?: Record<string, unknown> }) => {
          if (resource === 'configurations') {
            return Promise.resolve([]);
          }
          if (resource === 'products') {
            return Promise.resolve([{ id: '42' }]);
          }
          if (String(filters?.custom?.id_product) === '42') {
            return Promise.resolve([ownRow]);
          }
          return Promise.reject(new Error('stock read exploded'));
        }
      ) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      await expect(adapter.listInventory(productId)).rejects.toThrow('stock read exploded');
    });

    it('refuses to derive when the OR filter answered with an id nobody asked for', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], [
        { id: '201', id_product: '11', id_product_attribute: '0', quantity: '7' },
        { id: '999', id_product: '77', id_product_attribute: '0', quantity: '0' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      await expect(adapter.listInventory(productId)).rejects.toThrow(
        PrestashopPackFilterIgnoredException
      );
    });

    it('refuses to derive when the OR filter answered with no rows at all', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], []);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      await expect(adapter.listInventory(productId)).rejects.toThrow(
        PrestashopPackFilterIgnoredException
      );
    });

    it('reports zero for a both-mode pack with no stock row of its own', async () => {
      mockHttpClient.listResources = stockRouter([], componentRows);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('2'));

      const result = await adapter.listInventory(productId);

      // PrestaShop seeds a both-mode pack from its own row and reads a missing
      // row as 0, so the components cannot lift it.
      expect(result[0].quantity).toBe(0);
    });

    it('takes the lowest row when a multistore shop answers several per component', async () => {
      mockHttpClient.listResources = stockRouter([ownRow], [
        { id: '201', id_product: '11', id_product_attribute: '0', quantity: '40' },
        { id: '203', id_product: '11', id_product_attribute: '0', quantity: '4' },
        { id: '202', id_product: '12', id_product_attribute: '0', quantity: '5' },
      ]);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- test mock: narrowing dynamic spy / fixture / response shape
      mockHttpClient.getResource = jest.fn().mockResolvedValue(packProduct('1'));

      const result = await adapter.listInventory(productId);

      // 4 units consumed 2 at a time allow 2 packs, not the 20 the other row
      // would claim.
      expect(result[0].quantity).toBe(2);
    });

    it('reports the pack own row when the pack ids could not be resolved', async () => {
      const listResources = jest.fn((resource: string) => {
        if (resource === 'products') {
          return Promise.reject(new Error('no products permission'));
        }
        return Promise.resolve([ownRow]);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];
      mockHttpClient.listResources = listResources;

      const result = await adapter.listInventory(productId);

      // Degrades to the pre-pack behaviour, and crucially never probes the
      // product resource per product.
      expect(result[0].quantity).toBe(99);
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
    });

    it('never reports a truncated pack-id enumeration as the whole set', async () => {
      const fullPage = Array.from({ length: 100 }, (_, index) => ({ id: String(1000 + index) }));
      mockHttpClient.listResources = jest.fn((resource: string) => {
        if (resource === 'products') {
          // Always full: the shop never reaches the end of the collection.
          return Promise.resolve(fullPage);
        }
        return Promise.resolve([ownRow]);
      }) as unknown as jest.Mocked<IPrestashopWebserviceClient>['listResources'];

      // A partial set would classify a real pack as ordinary and keep selling
      // off its stale own row, so the read fails instead of answering.
      await expect(packResolver.resolvePackIds(connection.id, mockHttpClient)).rejects.toBeInstanceOf(
        PrestashopTruncatedReadException
      );
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

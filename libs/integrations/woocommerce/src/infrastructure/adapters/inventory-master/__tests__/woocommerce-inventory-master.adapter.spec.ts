/**
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/inventory-master/__tests__
 */
import { WooCommerceInventoryMasterAdapter } from '../woocommerce-inventory-master.adapter';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceNotSupportedException } from '../../../../domain/exceptions/woocommerce-not-supported.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { IdentifierMappingPort, Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONNECTION_ID = 'conn-wc-1';

const makeConnection = (): Connection =>
  ({
    id: CONNECTION_ID,
    platformType: 'woocommerce',
    name: 'Test WC',
    status: 'active',
    config: { siteUrl: 'https://myshop.example.com' },
    credentialsRef: 'cred-ref',
    enabledCapabilities: ['InventoryMaster'],
    adapterKey: 'woocommerce.restapi.v3',
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Connection;

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } as unknown as jest.Mocked<IWooCommerceHttpClient>;
}

function makeIdentifierMapping(): jest.Mocked<IdentifierMappingPort> {
  return {
    getExternalIds: jest.fn(),
    getOrCreateInternalId: jest.fn(),
    batchGetOrCreateInternalIds: jest.fn(),
    getInternalId: jest.fn(),
    createMapping: jest.fn(),
  } as unknown as jest.Mocked<IdentifierMappingPort>;
}

function setupProductMapping(
  identifierMapping: jest.Mocked<IdentifierMappingPort>,
  productId: string,
  wcId: number,
): void {
  identifierMapping.getExternalIds.mockImplementation((entityType, id) => {
    if (entityType === CORE_ENTITY_TYPE.Product && id === productId) {
      return Promise.resolve([{ externalId: String(wcId), connectionId: CONNECTION_ID, entityType, platformType: 'woocommerce' }]);
    }
    return Promise.resolve([]);
  });
}

function makeSimpleProduct(overrides: Record<string, unknown> = {}) {
  return { id: 1, type: 'simple', stock_quantity: 10, manage_stock: true, ...overrides };
}

function makeVariableProduct(variationIds: number[]) {
  return { id: 1, type: 'variable', variations: variationIds };
}

function makeVariation(id: number, stock_quantity: number | null = 5) {
  return { id, stock_quantity, manage_stock: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WooCommerceInventoryMasterAdapter', () => {
  let httpClient: jest.Mocked<IWooCommerceHttpClient>;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let adapter: WooCommerceInventoryMasterAdapter;

  beforeEach(() => {
    httpClient = makeHttpClient();
    identifierMapping = makeIdentifierMapping();
    adapter = new WooCommerceInventoryMasterAdapter(httpClient, identifierMapping, makeConnection());
  });

  // ── listInventory ──────────────────────────────────────────────────────────

  describe('listInventory', () => {
    it('should return a single inventory row with synthetic variantId for a simple product', async () => {
      setupProductMapping(identifierMapping, 'ol-product-1', 42);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 42, stock_quantity: 10 }));
      identifierMapping.getOrCreateInternalId
        .mockResolvedValueOnce('ol-variant-synthetic')
        .mockResolvedValueOnce('ol-inventory-1');

      const rows = await adapter.listInventory('ol-product-1');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productId: 'ol-product-1',
        variantId: 'ol-variant-synthetic',
        id: 'ol-inventory-1',
        quantity: 10,
        reserved: 0,
        available: 10,
      });
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        CORE_ENTITY_TYPE.ProductVariant,
        'product:42',
        CONNECTION_ID,
        expect.objectContaining({ parentEntityType: CORE_ENTITY_TYPE.Product }),
      );
    });

    it('should return one inventory row per variation for a variable product', async () => {
      setupProductMapping(identifierMapping, 'ol-product-2', 99);
      httpClient.get
        .mockResolvedValueOnce(makeVariableProduct([10, 11]))      // product
        .mockResolvedValueOnce([makeVariation(10, 3), makeVariation(11, 7)]); // variations page 1
      identifierMapping.batchGetOrCreateInternalIds
        .mockResolvedValueOnce(new Map([[`10:${CONNECTION_ID}`, 'ol-var-10'], [`11:${CONNECTION_ID}`, 'ol-var-11']]))
        .mockResolvedValueOnce(new Map([[`stock-var:10:${CONNECTION_ID}`, 'ol-inv-10'], [`stock-var:11:${CONNECTION_ID}`, 'ol-inv-11']]));

      const rows = await adapter.listInventory('ol-product-2');

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ variantId: 'ol-var-10', quantity: 3 });
      expect(rows[1]).toMatchObject({ variantId: 'ol-var-11', quantity: 7 });
    });

    it('should map stock_quantity = null to quantity = 0', async () => {
      setupProductMapping(identifierMapping, 'ol-product-3', 55);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 55, stock_quantity: null }));
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      const [row] = await adapter.listInventory('ol-product-3');

      expect(row.quantity).toBe(0);
      expect(row.available).toBe(0);
    });

    it('should map stock_quantity = null (manage_stock=false) to quantity = 0', async () => {
      setupProductMapping(identifierMapping, 'ol-product-4', 56);
      httpClient.get.mockResolvedValue({ id: 56, type: 'simple', stock_quantity: null, manage_stock: false });
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      const [row] = await adapter.listInventory('ol-product-4');

      expect(row.quantity).toBe(0);
    });

    it('should throw WooCommerceResourceNotFoundException when product has no mapping', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(adapter.listInventory('ol-unmapped')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  // ── getInventory ──────────────────────────────────────────────────────────

  describe('getInventory', () => {
    it('should return the first row from listInventory', async () => {
      setupProductMapping(identifierMapping, 'ol-product-5', 10);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 10, stock_quantity: 5 }));
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      const inv = await adapter.getInventory('ol-product-5');

      expect(inv.quantity).toBe(5);
    });

    it('should throw WooCommerceResourceNotFoundException when listInventory returns empty', async () => {
      setupProductMapping(identifierMapping, 'ol-product-6', 11);
      // variable product with no variations
      httpClient.get.mockResolvedValue({ id: 11, type: 'variable', variations: [] });
      httpClient.get.mockResolvedValueOnce({ id: 11, type: 'variable' }).mockResolvedValueOnce([]);
      identifierMapping.batchGetOrCreateInternalIds.mockResolvedValue(new Map());

      await expect(adapter.getInventory('ol-product-6')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  // ── getAvailableQuantity ──────────────────────────────────────────────────

  describe('getAvailableQuantity', () => {
    it('should return inventory.available', async () => {
      setupProductMapping(identifierMapping, 'ol-product-7', 20);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 20, stock_quantity: 8 }));
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      const qty = await adapter.getAvailableQuantity('ol-product-7');

      expect(qty).toBe(8);
    });
  });

  // ── adjustInventory ──────────────────────────────────────────────────────

  describe('adjustInventory', () => {
    it('should read current stock, compute absolute, and PUT for a simple product', async () => {
      setupProductMapping(identifierMapping, 'ol-product-8', 30);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 30, stock_quantity: 10 }));
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      await adapter.adjustInventory({ productId: 'ol-product-8', quantity: 5 });

      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/30', {
        stock_quantity: 15, // 10 + 5
        manage_stock: true,
      });
    });

    it('should clamp newQuantity to 0 when delta exceeds current stock', async () => {
      setupProductMapping(identifierMapping, 'ol-product-8b', 31);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 31, stock_quantity: 3 }));
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-id');

      await adapter.adjustInventory({ productId: 'ol-product-8b', quantity: -10 });

      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/31',
        expect.objectContaining({ stock_quantity: 0 }),
      );
    });

    it('should resolve variation and PUT to variations endpoint', async () => {
      setupProductMapping(identifierMapping, 'ol-product-9', 40);
      httpClient.get
        .mockResolvedValueOnce({ id: 40, type: 'variable' })
        .mockResolvedValueOnce(makeVariation(55, 7));
      identifierMapping.getExternalIds
        .mockImplementation((entityType, id) => {
          if (entityType === CORE_ENTITY_TYPE.Product) return Promise.resolve([{ externalId: '40', connectionId: CONNECTION_ID, entityType, platformType: 'woocommerce' }]);
          if (entityType === CORE_ENTITY_TYPE.ProductVariant && id === 'ol-var-55') return Promise.resolve([{ externalId: '55', connectionId: CONNECTION_ID, entityType, platformType: 'woocommerce' }]);
          return Promise.resolve([]);
        });
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol-inv-55');

      await adapter.adjustInventory({ productId: 'ol-product-9', quantity: 3, variantId: 'ol-var-55' });

      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/40/variations/55', {
        stock_quantity: 10, // 7 + 3
        manage_stock: true,
      });
    });

    it('should throw WooCommerceResourceNotFoundException when product is not mapped', async () => {
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(
        adapter.adjustInventory({ productId: 'ol-unmapped', quantity: 1 }),
      ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
    });

    it('should throw WooCommerceNotSupportedException for variable product without variantId', async () => {
      setupProductMapping(identifierMapping, 'ol-product-10', 50);
      httpClient.get.mockResolvedValue({ id: 50, type: 'variable' });

      await expect(
        adapter.adjustInventory({ productId: 'ol-product-10', quantity: 1 }),
      ).rejects.toBeInstanceOf(WooCommerceNotSupportedException);
    });
  });

  // ── reserveInventory / releaseInventory ───────────────────────────────────

  describe('reserveInventory', () => {
    it('should throw WooCommerceNotSupportedException', async () => {
      await expect(adapter.reserveInventory('any', 1, 'order-1')).rejects.toBeInstanceOf(
        WooCommerceNotSupportedException,
      );
    });
  });

  describe('releaseInventory', () => {
    it('should throw WooCommerceNotSupportedException', async () => {
      await expect(adapter.releaseInventory('any', 1, 'order-1')).rejects.toBeInstanceOf(
        WooCommerceNotSupportedException,
      );
    });
  });
});

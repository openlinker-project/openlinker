/**
 * WooCommerce Inventory Master Adapter — unit tests
 *
 * Uses the published in-memory identifier-mapping fake
 * (`@openlinker/core/identifier-mapping/testing`) rather than a hand-rolled
 * jest mock, so the composite-key format (`${externalId}:${connectionId}`)
 * produced by `batchGetOrCreateInternalIds` can never silently drift from the
 * key the adapter reads back (the B1 regression this guards against).
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/inventory-master/__tests__
 */
import { WooCommerceInventoryMasterAdapter } from '../woocommerce-inventory-master.adapter';
import { WooCommerceResourceNotFoundException } from '../../../../domain/exceptions/woocommerce-resource-not-found.exception';
import { WooCommerceNotSupportedException } from '../../../../domain/exceptions/woocommerce-not-supported.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { CORE_ENTITY_TYPE } from '@openlinker/core/identifier-mapping';
import { InMemoryIdentifierMappingAdapter } from '@openlinker/core/identifier-mapping/testing';
import { DEFAULT_UNMANAGED_STOCK_QUANTITY } from '../../../../domain/types/woocommerce-config.types';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const CONNECTION_ID = 'conn-wc-1';

const makeConnection = (config: Record<string, unknown> = { siteUrl: 'https://myshop.example.com' }): Connection =>
  ({
    id: CONNECTION_ID,
    platformType: 'woocommerce',
    name: 'Test WC',
    status: 'active',
    config,
    credentialsRef: 'cred-ref',
    enabledCapabilities: ['InventoryMaster'],
    adapterKey: 'woocommerce.restapi.v3',
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as Connection;

function makeHttpClient(): jest.Mocked<IWooCommerceHttpClient> {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } as unknown as jest.Mocked<IWooCommerceHttpClient>;
}

/**
 * Seed a Product → WC-id mapping into the fake so `resolveWcProductId` finds it.
 */
function seedProductMapping(
  identifierMapping: InMemoryIdentifierMappingAdapter,
  productId: string,
  wcId: number,
): void {
  identifierMapping.seed({
    entityType: CORE_ENTITY_TYPE.Product,
    externalId: String(wcId),
    connectionId: CONNECTION_ID,
    internalId: productId,
  });
}

function makeSimpleProduct(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 1, type: 'simple', stock_quantity: 10, manage_stock: true, ...overrides };
}

function makeVariableProduct(variationIds: number[]): Record<string, unknown> {
  return { id: 1, type: 'variable', variations: variationIds };
}

function makeVariation(id: number, stock_quantity: number | null = 5): Record<string, unknown> {
  return { id, stock_quantity, manage_stock: true };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('WooCommerceInventoryMasterAdapter', () => {
  let httpClient: jest.Mocked<IWooCommerceHttpClient>;
  let identifierMapping: InMemoryIdentifierMappingAdapter;
  let adapter: WooCommerceInventoryMasterAdapter;

  beforeEach(() => {
    httpClient = makeHttpClient();
    identifierMapping = new InMemoryIdentifierMappingAdapter({ [CONNECTION_ID]: 'woocommerce' });
    adapter = new WooCommerceInventoryMasterAdapter(httpClient, identifierMapping, makeConnection());
  });

  // ── listInventory ──────────────────────────────────────────────────────────

  describe('listInventory', () => {
    it('should return a single inventory row with synthetic variantId for a simple product', async () => {
      seedProductMapping(identifierMapping, 'ol-product-1', 42);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 42, stock_quantity: 10 }));

      const rows = await adapter.listInventory('ol-product-1');

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        productId: 'ol-product-1',
        quantity: 10,
        reserved: 0,
        available: 10,
      });
      // The synthetic variant id was minted through getOrCreateInternalId
      // keyed on `product:42` — assert it round-trips to a defined internal id.
      expect(rows[0].variantId).toBeDefined();
      expect(
        await identifierMapping.getInternalId(CORE_ENTITY_TYPE.ProductVariant, 'product:42', CONNECTION_ID),
      ).toBe(rows[0].variantId);
      expect(rows[0].id).toBeDefined();
    });

    it('should return one inventory row per variation for a variable product', async () => {
      seedProductMapping(identifierMapping, 'ol-product-2', 99);
      httpClient.get
        .mockResolvedValueOnce(makeVariableProduct([10, 11]))      // product
        .mockResolvedValueOnce([makeVariation(10, 3), makeVariation(11, 7)]); // variations page 1

      const rows = await adapter.listInventory('ol-product-2');

      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({ quantity: 3 });
      expect(rows[1]).toMatchObject({ quantity: 7 });
      // B1 guard: each row must carry a DEFINED variantId/id — a composite-key
      // mismatch would leave these undefined.
      expect(rows[0].variantId).toBeDefined();
      expect(rows[0].id).toBeDefined();
      expect(rows[1].variantId).toBeDefined();
      expect(rows[1].id).toBeDefined();
      // variantIds resolve to the variation external ids that were created.
      expect(
        await identifierMapping.getInternalId(CORE_ENTITY_TYPE.ProductVariant, '10', CONNECTION_ID),
      ).toBe(rows[0].variantId);
      expect(
        await identifierMapping.getInternalId(CORE_ENTITY_TYPE.ProductVariant, '11', CONNECTION_ID),
      ).toBe(rows[1].variantId);
    });

    it('should map stock_quantity = null to quantity = 0 for managed stock', async () => {
      seedProductMapping(identifierMapping, 'ol-product-3', 55);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 55, stock_quantity: null }));

      const [row] = await adapter.listInventory('ol-product-3');

      expect(row.quantity).toBe(0);
      expect(row.available).toBe(0);
    });

    it('should emit quantity=0 when manage_stock=false and stock_status is not instock', async () => {
      seedProductMapping(identifierMapping, 'ol-product-4', 56);
      httpClient.get.mockResolvedValue({ id: 56, type: 'simple', stock_quantity: null, manage_stock: false, stock_status: 'outofstock' });

      const [row] = await adapter.listInventory('ol-product-4');

      expect(row.quantity).toBe(0);
    });

    it('should emit the default unmanaged cap when manage_stock=false and stock_status=instock', async () => {
      seedProductMapping(identifierMapping, 'ol-product-4b', 57);
      httpClient.get.mockResolvedValue({ id: 57, type: 'simple', stock_quantity: null, manage_stock: false, stock_status: 'instock' });

      const [row] = await adapter.listInventory('ol-product-4b');

      // manage_stock=false + instock → per-connection cap (default), NOT 0:
      // master is authoritative; reporting 0 would de-list a sellable product.
      expect(row.quantity).toBe(DEFAULT_UNMANAGED_STOCK_QUANTITY);
      expect(row.available).toBe(DEFAULT_UNMANAGED_STOCK_QUANTITY);
    });

    it('should honour a per-connection unmanagedStockQuantity override', async () => {
      const customAdapter = new WooCommerceInventoryMasterAdapter(
        httpClient,
        identifierMapping,
        makeConnection({ siteUrl: 'https://myshop.example.com', inventory: { unmanagedStockQuantity: 5 } }),
      );
      seedProductMapping(identifierMapping, 'ol-product-4c', 58);
      httpClient.get.mockResolvedValue({ id: 58, type: 'simple', stock_quantity: null, manage_stock: false, stock_status: 'instock' });

      const [row] = await customAdapter.listInventory('ol-product-4c');

      expect(row.quantity).toBe(5);
    });

    it('should throw WooCommerceResourceNotFoundException when product has no mapping', async () => {
      await expect(adapter.listInventory('ol-unmapped')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  // ── getInventory ──────────────────────────────────────────────────────────

  describe('getInventory', () => {
    it('should return the first row from listInventory', async () => {
      seedProductMapping(identifierMapping, 'ol-product-5', 10);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 10, stock_quantity: 5 }));

      const inv = await adapter.getInventory('ol-product-5');

      expect(inv.quantity).toBe(5);
    });

    it('should throw WooCommerceResourceNotFoundException when listInventory returns empty', async () => {
      seedProductMapping(identifierMapping, 'ol-product-6', 11);
      // variable product with no variations
      httpClient.get.mockResolvedValueOnce({ id: 11, type: 'variable' }).mockResolvedValueOnce([]);

      await expect(adapter.getInventory('ol-product-6')).rejects.toBeInstanceOf(
        WooCommerceResourceNotFoundException,
      );
    });
  });

  // ── getAvailableQuantity ──────────────────────────────────────────────────

  describe('getAvailableQuantity', () => {
    it('should return inventory.available', async () => {
      seedProductMapping(identifierMapping, 'ol-product-7', 20);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 20, stock_quantity: 8 }));

      const qty = await adapter.getAvailableQuantity('ol-product-7');

      expect(qty).toBe(8);
    });
  });

  // ── adjustInventory ──────────────────────────────────────────────────────

  describe('adjustInventory', () => {
    it('should read current stock, compute absolute, and PUT for a simple product', async () => {
      seedProductMapping(identifierMapping, 'ol-product-8', 30);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 30, stock_quantity: 10 }));

      await adapter.adjustInventory({ productId: 'ol-product-8', quantity: 5 });

      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/30', {
        stock_quantity: 15, // 10 + 5
        manage_stock: true,
      });
    });

    it('should clamp newQuantity to 0 when delta exceeds current stock', async () => {
      seedProductMapping(identifierMapping, 'ol-product-8b', 31);
      httpClient.get.mockResolvedValue(makeSimpleProduct({ id: 31, stock_quantity: 3 }));

      await adapter.adjustInventory({ productId: 'ol-product-8b', quantity: -10 });

      expect(httpClient.put).toHaveBeenCalledWith(
        '/wp-json/wc/v3/products/31',
        expect.objectContaining({ stock_quantity: 0 }),
      );
    });

    it('should resolve variation and PUT to variations endpoint', async () => {
      seedProductMapping(identifierMapping, 'ol-product-9', 40);
      // Seed the variant → WC-variation-id mapping the adapter reads back.
      identifierMapping.seed({
        entityType: CORE_ENTITY_TYPE.ProductVariant,
        externalId: '55',
        connectionId: CONNECTION_ID,
        internalId: 'ol-var-55',
      });
      httpClient.get
        .mockResolvedValueOnce({ id: 40, type: 'variable' })
        .mockResolvedValueOnce(makeVariation(55, 7));

      await adapter.adjustInventory({ productId: 'ol-product-9', quantity: 3, variantId: 'ol-var-55' });

      expect(httpClient.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/40/variations/55', {
        stock_quantity: 10, // 7 + 3
        manage_stock: true,
      });
    });

    it('should throw WooCommerceResourceNotFoundException when product is not mapped', async () => {
      await expect(
        adapter.adjustInventory({ productId: 'ol-unmapped', quantity: 1 }),
      ).rejects.toBeInstanceOf(WooCommerceResourceNotFoundException);
    });

    it('should throw WooCommerceNotSupportedException for variable product without variantId', async () => {
      seedProductMapping(identifierMapping, 'ol-product-10', 50);
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

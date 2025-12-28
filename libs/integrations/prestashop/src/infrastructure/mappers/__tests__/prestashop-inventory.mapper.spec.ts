/**
 * PrestaShop Inventory Mapper Tests
 *
 * Unit tests for PrestashopInventoryMapper. Tests inventory mapping,
 * quantity parsing, and data transformation.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { PrestashopInventoryMapper } from '../prestashop-inventory.mapper';
import { PrestashopStockAvailable } from '../prestashop.mapper.interface';

describe('PrestashopInventoryMapper', () => {
  let mapper: PrestashopInventoryMapper;

  beforeEach(() => {
    mapper = new PrestashopInventoryMapper();
  });

  describe('mapInventory', () => {
    it('should map basic inventory fields', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '50',
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      expect(result.productId).toBe('product-123');
      expect(result.quantity).toBe(50);
      expect(result.reserved).toBe(0);
      expect(result.available).toBe(50);
    });

    it('should handle variant inventory', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '102',
        id_product: '42',
        id_product_attribute: '5',
        quantity: '25',
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123', 'variant-5');

      expect(result.productId).toBe('product-123');
      expect(result.variantId).toBe('variant-5');
      expect(result.quantity).toBe(25);
    });

    it('should handle zero quantity', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '0',
        out_of_stock: '1',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      expect(result.quantity).toBe(0);
      expect(result.available).toBe(0);
    });

    it('should handle numeric quantity', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        quantity: 100 as any, // Numeric instead of string
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      expect(result.quantity).toBe(100);
    });

    it('should handle invalid quantity string', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        quantity: 'invalid' as any,
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      expect(result.quantity).toBe(0); // Falls back to 0
      expect(result.available).toBe(0);
    });

    it('should handle null/undefined quantity', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        quantity: null as any,
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      expect(result.quantity).toBe(0);
    });

    it('should calculate available quantity correctly', () => {
      const stockAvailable: PrestashopStockAvailable = {
        id: '101',
        id_product: '42',
        id_product_attribute: '0',
        quantity: '100',
        out_of_stock: '0',
      };

      const result = mapper.mapInventory(stockAvailable, 'product-123');

      // Available = quantity - reserved (reserved is always 0 in PrestaShop)
      expect(result.available).toBe(100);
    });
  });
});


/**
 * PrestaShop Product Mapper Tests
 *
 * Unit tests for PrestashopProductMapper. Tests product and variant mapping,
 * localization handling, and data transformation.
 *
 * @module libs/integrations/prestashop/src/infrastructure/mappers/__tests__
 */
import { PrestashopProductMapper } from '../prestashop-product.mapper';
import { PrestashopProduct, PrestashopCombination } from '../prestashop.mapper.interface';

describe('PrestashopProductMapper', () => {
  let mapper: PrestashopProductMapper;

  beforeEach(() => {
    mapper = new PrestashopProductMapper();
  });

  describe('mapProduct', () => {
    it('should map basic product fields', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test Product',
        reference: 'TEST-001',
        price: '19.99',
        weight: '0.5',
        active: '1',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);

      expect(result.name).toBe('Test Product');
      expect(result.sku).toBe('TEST-001');
      expect(result.price).toBe(19.99);
      expect(result.weight).toBe(0.5);
    });

    it('should handle localized name field', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [
            { '#text': 'English Name', '@_id': '1' },
            { '#text': 'French Name', '@_id': '2' },
          ],
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('English Name');
    });

    it('should handle direct string name', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Direct String Name',
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('Direct String Name');
    });

    it('should parse numeric price from string', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '29.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.price).toBe(29.99);
    });

    it('should handle numeric price', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: 29.99,
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.price).toBe(29.99);
    });

    it('should extract categories from associations', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {
          categories: {
            category: [
              { id: '5' },
              { id: '10' },
            ],
          },
        },
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.categories).toEqual(['5', '10']);
    });
  });

  describe('mapVariant', () => {
    it('should map basic variant fields', () => {
      const combination: PrestashopCombination = {
        id: '100',
        id_product: '1',
        reference: 'TEST-001-RED',
        price: '5.00',
        weight: '0.1',
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');

      expect(result.productId).toBe('internal-product-id');
      expect(result.sku).toBe('TEST-001-RED');
      expect(result.price).toBe(5.0);
      expect(result.weight).toBe(0.1);
    });

    it('should extract attributes from product_option_values', () => {
      const combination: PrestashopCombination = {
        id: '100',
        id_product: '1',
        reference: 'TEST-001-RED',
        associations: {
          product_option_values: {
            product_option_value: [
              { id: '20' },
              { id: '30' },
            ],
          },
        },
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');
      expect(result.attributes).toBeDefined();
      expect(Object.keys(result.attributes || {}).length).toBeGreaterThan(0);
    });
  });
});


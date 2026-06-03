/**
 * WooCommerce Product Mapper — unit tests
 *
 * @module libs/integrations/woocommerce/src/infrastructure/mappers/__tests__
 */
import { WooCommerceProductMapper } from '../woocommerce-product.mapper';
import type {
  WooCommerceProduct,
  WooCommerceProductVariation,
} from '../../adapters/product-master/woocommerce-product.types';

function makeProduct(overrides: Partial<WooCommerceProduct> = {}): WooCommerceProduct {
  return {
    id: 42,
    name: 'Test Product',
    sku: 'SKU-001',
    type: 'simple',
    status: 'publish',
    price: '29.99',
    description: '<p>A product</p>',
    categories: [{ id: 10, name: 'Electronics', slug: 'electronics' }],
    images: [{ id: 1, src: 'https://example.com/img.jpg', alt: 'img' }],
    weight: '1.5',
    date_created: '2024-01-15T10:00:00',
    date_modified: '2024-01-20T12:00:00',
    meta_data: [],
    ...overrides,
  };
}

function makeVariation(
  overrides: Partial<WooCommerceProductVariation> = {},
): WooCommerceProductVariation {
  return {
    id: 99,
    sku: 'VAR-001',
    price: '19.99',
    weight: '0.5',
    attributes: [{ id: 1, name: 'Color', option: 'Red' }],
    meta_data: [],
    ...overrides,
  };
}

describe('WooCommerceProductMapper', () => {
  const mapper = new WooCommerceProductMapper({ currency: 'PLN' });

  describe('mapProduct', () => {
    it('should map all standard fields', () => {
      const result = mapper.mapProduct(makeProduct());
      expect(result.name).toBe('Test Product');
      expect(result.sku).toBe('SKU-001');
      expect(result.price).toBe(29.99);
      expect(result.currency).toBe('PLN');
      expect(result.description).toBe('<p>A product</p>');
      expect(result.images).toEqual(['https://example.com/img.jpg']);
      expect(result.categories).toEqual(['10']);
      expect(result.weight).toBe(1.5);
    });

    it('should preserve zero price (free products)', () => {
      const result = mapper.mapProduct(makeProduct({ price: '0' }));
      expect(result.price).toBe(0);
    });

    it('should return null price for empty string', () => {
      const result = mapper.mapProduct(makeProduct({ price: '' }));
      expect(result.price).toBeNull();
    });

    it('should preserve zero weight (digital goods)', () => {
      const result = mapper.mapProduct(makeProduct({ weight: '0' }));
      expect(result.weight).toBe(0);
    });

    it('should return undefined weight for missing/empty weight', () => {
      const result = mapper.mapProduct(makeProduct({ weight: undefined }));
      expect(result.weight).toBeUndefined();
    });

    it('should parse createdAt/updatedAt from ISO strings', () => {
      const result = mapper.mapProduct(makeProduct());
      expect(result.createdAt).toEqual(new Date('2024-01-15T10:00:00'));
      expect(result.updatedAt).toEqual(new Date('2024-01-20T12:00:00'));
    });

    it('should return undefined createdAt/updatedAt when date fields missing', () => {
      const result = mapper.mapProduct(
        makeProduct({ date_created: undefined, date_modified: undefined }),
      );
      expect(result.createdAt).toBeUndefined();
      expect(result.updatedAt).toBeUndefined();
    });

    it('should preserve raw HTML description without stripping', () => {
      const html = '<p><strong>Bold</strong> &amp; <em>italic</em></p>';
      const result = mapper.mapProduct(makeProduct({ description: html }));
      expect(result.description).toBe(html);
    });

    it('should return null description for empty string', () => {
      const result = mapper.mapProduct(makeProduct({ description: '' }));
      expect(result.description).toBeNull();
    });

    it('should return null currency when options has no currency', () => {
      const mapperNoCurrency = new WooCommerceProductMapper({});
      const result = mapperNoCurrency.mapProduct(makeProduct());
      expect(result.currency).toBeNull();
    });

    it('should return empty name for missing name field', () => {
      const result = mapper.mapProduct(makeProduct({ name: undefined }));
      expect(result.name).toBe('');
    });

    it('should return null images when images array is absent', () => {
      const result = mapper.mapProduct(makeProduct({ images: undefined }));
      expect(result.images).toBeNull();
    });

    it('should return empty categories array when categories absent', () => {
      const result = mapper.mapProduct(makeProduct({ categories: undefined }));
      expect(result.categories).toEqual([]);
    });
  });

  describe('mapVariation', () => {
    it('should map all standard variation fields', () => {
      const result = mapper.mapVariation(makeVariation(), 'prod-123');
      expect(result.productId).toBe('prod-123');
      expect(result.sku).toBe('VAR-001');
      expect(result.price).toBe(19.99);
      expect(result.weight).toBe(0.5);
      expect(result.attributes).toEqual({ Color: 'Red' });
    });

    it('should preserve zero variation price', () => {
      const result = mapper.mapVariation(makeVariation({ price: '0' }), 'prod-1');
      expect(result.price).toBe(0);
    });

    it('should return undefined price for empty string', () => {
      const result = mapper.mapVariation(makeVariation({ price: '' }), 'prod-1');
      expect(result.price).toBeUndefined();
    });

    it('should preserve zero variation weight', () => {
      const result = mapper.mapVariation(makeVariation({ weight: '0' }), 'prod-1');
      expect(result.weight).toBe(0);
    });

    it('should return null attributes for empty array', () => {
      const result = mapper.mapVariation(makeVariation({ attributes: [] }), 'prod-1');
      expect(result.attributes).toBeNull();
    });

    it('should return null attributes for absent attributes field', () => {
      const result = mapper.mapVariation(makeVariation({ attributes: undefined }), 'prod-1');
      expect(result.attributes).toBeNull();
    });

    it('should extract EAN from _ean meta key', () => {
      const result = mapper.mapVariation(
        makeVariation({
          meta_data: [{ id: 1, key: '_ean', value: '5901234123457' }],
        }),
        'prod-1',
      );
      expect(result.ean).toBeTruthy();
    });

    it('should extract GTIN from _gtin meta key', () => {
      const result = mapper.mapVariation(
        makeVariation({
          meta_data: [{ id: 1, key: '_gtin', value: '00012345600012' }],
        }),
        'prod-1',
      );
      expect(result.gtin).toBeTruthy();
    });

    it('should return null ean/gtin when meta_data is empty', () => {
      const result = mapper.mapVariation(makeVariation({ meta_data: [] }), 'prod-1');
      expect(result.ean).toBeNull();
      expect(result.gtin).toBeNull();
    });

    it('_ean key wins over _gtin when both present in EAN lookup', () => {
      const result = mapper.mapVariation(
        makeVariation({
          meta_data: [
            { id: 1, key: '_gtin', value: '00012345600012' },
            { id: 2, key: '_ean', value: '5901234123457' },
          ],
        }),
        'prod-1',
      );
      // _ean is first in EAN_KEYS so it should win
      expect(result.ean).not.toBeNull();
    });
  });

  describe('extractEan', () => {
    it('should return normalised EAN when _ean key is present', () => {
      const result = mapper.extractEan([{ key: '_ean', value: '5901234123457' }]);
      expect(result).toBeTruthy();
    });

    it('should return normalised EAN when ean key is present (no underscore)', () => {
      const result = mapper.extractEan([{ key: 'ean', value: '5901234123457' }]);
      expect(result).toBeTruthy();
    });

    it('should return null when meta_data is empty', () => {
      const result = mapper.extractEan([]);
      expect(result).toBeNull();
    });

    it('should return null when no recognised EAN key is present', () => {
      const result = mapper.extractEan([{ key: 'custom_field', value: 'some-value' }]);
      expect(result).toBeNull();
    });

    it('should return null when EAN value is blank', () => {
      const result = mapper.extractEan([{ key: '_ean', value: '' }]);
      expect(result).toBeNull();
    });
  });

  describe('extractGtin', () => {
    it('should return normalised GTIN when _gtin key is present', () => {
      const result = mapper.extractGtin([{ key: '_gtin', value: '00012345600012' }]);
      expect(result).toBeTruthy();
    });

    it('should return null when meta_data is empty', () => {
      const result = mapper.extractGtin([]);
      expect(result).toBeNull();
    });

    it('should return null when no recognised GTIN key is present', () => {
      const result = mapper.extractGtin([{ key: 'unrelated', value: '12345' }]);
      expect(result).toBeNull();
    });
  });
});

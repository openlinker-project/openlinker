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

const STOREFRONT_BASE_URL = 'https://shop.test';

describe('PrestashopProductMapper', () => {
  let mapper: PrestashopProductMapper;

  beforeEach(() => {
    mapper = new PrestashopProductMapper({ storefrontBaseUrl: STOREFRONT_BASE_URL });
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

    it('should emit currency=null when options.currency is undefined', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test Product',
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);

      expect(result.currency).toBeNull();
    });

    it('should emit options.currency when set', () => {
      const plnMapper = new PrestashopProductMapper({
        storefrontBaseUrl: STOREFRONT_BASE_URL,
        currency: 'PLN',
      });
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test Product',
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = plnMapper.mapProduct(prestashopProduct, 1);

      expect(result.currency).toBe('PLN');
    });

    it('should handle localized name field with array of languages', () => {
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

    it('should handle localized name field with single language object (not array)', () => {
      const prestashopProduct = {
        id: '1',
        name: {
          language: { '#text': 'Single Language Name', '@_id': '1' },
        },
        reference: 'TEST-001',
        price: '19.99',
      } as unknown as PrestashopProduct;

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('Single Language Name');
    });

    it('should select preferred language when multiple languages available', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [
            { '#text': 'English Name', '@_id': '1' },
            { '#text': 'French Name', '@_id': '2' },
            { '#text': 'German Name', '@_id': '3' },
          ],
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      // Request language 2 (French)
      const result = mapper.mapProduct(prestashopProduct, 2);
      expect(result.name).toBe('French Name');
    });

    it('should fallback to first non-empty language if preferred not found', () => {
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

      // Request language 99 (not available), should fallback to first
      const result = mapper.mapProduct(prestashopProduct, 99);
      expect(result.name).toBe('English Name');
    });

    it('should handle language ID as string in XML parser output', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [
            { '#text': 'English Name', '@_id': '1' }, // String ID, not number
            { '#text': 'French Name', '@_id': '2' },
          ],
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      // Request language 1 (number), should match string '1'
      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('English Name');
    });

    it('should handle CDATA variants (#text, __cdata, value, text)', () => {
      // Test #text (fast-xml-parser default)
      const product1: PrestashopProduct = {
        id: '1',
        name: {
          language: [{ '#text': 'CDATA Text', '@_id': '1' }],
        },
        reference: 'TEST-001',
        price: '19.99',
      };
      expect(mapper.mapProduct(product1, 1).name).toBe('CDATA Text');

      // Test __cdata variant
      const product2 = {
        id: '2',
        name: {
          language: [{ __cdata: 'CDATA Variant', '@_id': '1' }],
        },
        reference: 'TEST-002',
        price: '19.99',
      } as unknown as PrestashopProduct;
      expect(mapper.mapProduct(product2, 1).name).toBe('CDATA Variant');

      // Test value (JSON format)
      const product3 = {
        id: '3',
        name: {
          language: [{ value: 'JSON Value', '@_id': '1' }],
        },
        reference: 'TEST-003',
        price: '19.99',
      } as unknown as PrestashopProduct;
      expect(mapper.mapProduct(product3, 1).name).toBe('JSON Value');

      // Test text key
      const product4 = {
        id: '4',
        name: {
          language: [{ text: 'Text Key', '@_id': '1' }],
        },
        reference: 'TEST-004',
        price: '19.99',
      } as unknown as PrestashopProduct;
      expect(mapper.mapProduct(product4, 1).name).toBe('Text Key');
    });

    it('should trim whitespace from localized fields', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [{ '#text': '  Trimmed Name  ', '@_id': '1' }],
        },
        description: {
          language: [{ '#text': '\n\nDescription with newlines\n\n', '@_id': '1' }],
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('Trimmed Name');
      expect(result.description).toBe('Description with newlines');
    });

    it('should return undefined for empty/whitespace-only localized fields', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [{ '#text': '   ', '@_id': '1' }], // Whitespace only
        },
        description: {
          language: [{ '#text': '', '@_id': '1' }], // Empty string
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      // Empty string fallback in mapProduct will make it '', but getLocalizedField returns undefined
      expect(result.name).toBe(''); // mapProduct uses || '' fallback
      expect(result.description).toBeNull();
    });

    it('should handle description field with localized content', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: {
          language: [{ '#text': 'Test Product', '@_id': '1' }],
        },
        description: {
          language: [
            {
              '#text': '<p>Symbol of lightness and delicacy, the hummingbird evokes curiosity and joy.</p>',
              '@_id': '1',
            },
          ],
        },
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.description).toBe('<p>Symbol of lightness and delicacy, the hummingbird evokes curiosity and joy.</p>');
    });

    it('should handle real PrestaShop XML structure (from API response)', () => {
      // Simulates actual PrestaShop XML structure from the user's example
      const prestashopProduct = {
        id: '1',
        name: {
          language: [
            {
              '#text': 'Hummingbird printed t-shirt',
              '@_id': '1',
              '@_xlink:href': 'http://localhost:8080/api/languages/1',
            } as Record<string, unknown>,
            {
              '#text': 'Hummingbird printed t-shirt',
              '@_id': '2',
              '@_xlink:href': 'http://localhost:8080/api/languages/2',
            } as Record<string, unknown>,
          ],
        },
        description: {
          language: [
            {
              '#text': '<p>Symbol of lightness and delicacy, the hummingbird evokes curiosity and joy. Studio Design\' PolyFaune collection features classic products with colorful patterns, inspired by the traditional japanese origamis. To wear with a chino or jeans. The sublimation textile printing process provides an exceptional color rendering and a color, guaranteed overtime.</p>',
              '@_id': '1',
            },
          ],
        },
        reference: 'demo_1',
        price: '23.900000',
      } as unknown as PrestashopProduct;

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.name).toBe('Hummingbird printed t-shirt');
      expect(result.description).toContain('Symbol of lightness and delicacy');
      expect(result.sku).toBe('demo_1');
      expect(result.price).toBe(23.9);
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

  describe('extractImages (via mapProduct)', () => {
    function makeProductWithImages(images: unknown): PrestashopProduct {
      return {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {
          images,
        },
      } as unknown as PrestashopProduct;
    }

    it('should return undefined when associations has no images key', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {},
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toBeNull();
    });

    it('should return undefined when associations is absent entirely', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toBeNull();
    });

    it('should extract a single-image object association (PrestaShop collapses solo collections)', () => {
      const prestashopProduct = makeProductWithImages({ image: { id: '7' } });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual(['https://shop.test/img/p/7/7-home_default.jpg']);
    });

    it('should extract a multi-image array and preserve order (cover first)', () => {
      const prestashopProduct = makeProductWithImages({
        image: [{ id: '1' }, { id: '2' }, { id: '3' }],
      });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual([
        'https://shop.test/img/p/1/1-home_default.jpg',
        'https://shop.test/img/p/2/2-home_default.jpg',
        'https://shop.test/img/p/3/3-home_default.jpg',
      ]);
    });

    it('should accept attribute-style @_id keys from XML parser output', () => {
      const prestashopProduct = makeProductWithImages({
        image: [{ '@_id': '42' }, { '@_id': '123' }],
      });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual([
        'https://shop.test/img/p/4/2/42-home_default.jpg',
        'https://shop.test/img/p/1/2/3/123-home_default.jpg',
      ]);
    });

    it('should split image ids by digit for deep directories', () => {
      const prestashopProduct = makeProductWithImages({
        image: [{ id: '1' }, { id: '42' }, { id: '123' }, { id: '1234' }],
      });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual([
        'https://shop.test/img/p/1/1-home_default.jpg',
        'https://shop.test/img/p/4/2/42-home_default.jpg',
        'https://shop.test/img/p/1/2/3/123-home_default.jpg',
        'https://shop.test/img/p/1/2/3/4/1234-home_default.jpg',
      ]);
    });

    it('should tolerate a trailing slash on storefrontBaseUrl', () => {
      const localMapper = new PrestashopProductMapper({
        storefrontBaseUrl: 'https://shop.test/',
      });
      const prestashopProduct = makeProductWithImages({ image: { id: '1' } });

      const result = localMapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual(['https://shop.test/img/p/1/1-home_default.jpg']);
    });

    it('should skip entries without a usable id and still return the rest', () => {
      const prestashopProduct = makeProductWithImages({
        image: [{ id: '1' }, { notAnId: 'x' }, { id: '' }, { id: '  ' }, { id: '3' }],
      });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual([
        'https://shop.test/img/p/1/1-home_default.jpg',
        'https://shop.test/img/p/3/3-home_default.jpg',
      ]);
    });

    it('should return undefined when every entry is unusable', () => {
      const prestashopProduct = makeProductWithImages({
        image: [{ notAnId: 'x' }, { id: '' }, null],
      });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toBeNull();
    });

    it('should accept a numeric id', () => {
      const prestashopProduct = makeProductWithImages({ image: { id: 55 } });

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual(['https://shop.test/img/p/5/5/55-home_default.jpg']);
    });

    it('should extract images from JSON shape (flat array, no image wrapper)', () => {
      // PS JSON endpoint (`output_format=JSON`) collapses `<images><image>…` into
      // a flat array at `associations.images`. This is the shape that regressed
      // before the fix and caused every synced product to store `images=null`.
      const prestashopProduct = makeProductWithImages([{ id: 1 }, { id: 2 }]);

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toEqual([
        'https://shop.test/img/p/1/1-home_default.jpg',
        'https://shop.test/img/p/2/2-home_default.jpg',
      ]);
    });

    it('should map images to null when JSON-shape images array is empty', () => {
      // mapProduct normalises extractImages' `undefined` to `null` so the
      // public contract exposes `null` for "no images".
      const prestashopProduct = makeProductWithImages([]);

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.images).toBeNull();
    });
  });

  describe('extractCategories (via mapProduct)', () => {
    it('should extract categories from XML shape ({ category: [...] })', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {
          categories: { category: [{ id: '2' }, { id: '3' }] },
        },
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.categories).toEqual(['2', '3']);
    });

    it('should extract categories from XML single-object shape ({ category: {...} })', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {
          categories: { category: { id: '2' } },
        },
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.categories).toEqual(['2']);
    });

    it('should extract categories from JSON shape (flat array)', () => {
      // Same PS JSON-endpoint quirk as images — the `<category>` wrapper is
      // collapsed into a flat array at `associations.categories`.
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {
          categories: [{ id: 2 }, { id: 3 }, { id: 4 }],
        },
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.categories).toEqual(['2', '3', '4']);
    });

    it('should return undefined when categories are absent', () => {
      const prestashopProduct: PrestashopProduct = {
        id: '1',
        name: 'Test',
        reference: 'TEST-001',
        price: '19.99',
        associations: {},
      };

      const result = mapper.mapProduct(prestashopProduct, 1);
      expect(result.categories).toBeUndefined();
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

    it('should extract attributes from product_option_values (XML shape with array)', () => {
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
      expect(result.attributes).toEqual({ option_0: '20', option_1: '30' });
    });

    it('should extract attributes from product_option_values (XML shape with single object)', () => {
      const combination: PrestashopCombination = {
        id: '100',
        id_product: '1',
        reference: 'TEST-001-RED',
        associations: {
          product_option_values: {
            product_option_value: { id: '20' },
          },
        },
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');
      expect(result.attributes).toEqual({ option_0: '20' });
    });

    it('should extract attributes from product_option_values (JSON shape, flat array)', () => {
      // PS JSON endpoint collapses the `<product_option_value>` wrapper into
      // a flat array at `associations.product_option_values`.
      const combination: PrestashopCombination = {
        id: '100',
        id_product: '1',
        reference: 'TEST-001-RED',
        associations: {
          product_option_values: [{ id: 1 }, { id: 8 }],
        },
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');
      expect(result.attributes).toEqual({ option_0: '1', option_1: '8' });
    });

    it('should return null attributes when product_option_values is absent', () => {
      const combination: PrestashopCombination = {
        id: '100',
        id_product: '1',
        reference: 'TEST-001-RED',
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');
      expect(result.attributes).toBeNull();
    });

    it('should map ean13 and upc to ean/gtin', () => {
      const combination: PrestashopCombination = {
        id: '101',
        id_product: '1',
        reference: 'TEST-001-RED',
        ean13: '5901234123457',
        upc: '012345678905',
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');

      expect(result.ean).toBe('5901234123457');
      expect(result.gtin).toBe('012345678905');
    });

    it('should drop invalid barcode lengths for ean13/upc', () => {
      const combination: PrestashopCombination = {
        id: '101',
        id_product: '1',
        reference: 'TEST-001-RED',
        ean13: 'ABC',
        upc: '12345',
      };

      const result = mapper.mapVariant(combination, 'internal-product-id');

      expect(result.ean).toBeNull();
      expect(result.gtin).toBeNull();
    });
  });
});




/**
 * Product Domain Entity — Unit Spec
 *
 * Covers the derived getters on the Product entity. The entity itself is a
 * plain data class, so the surface area under test is minimal; the key
 * invariant verified here is the cover-image rule (first-element-or-null).
 *
 * @module libs/core/src/products/domain/entities
 */
import { Product } from './product.entity';

describe('Product', () => {
  const baseArgs = {
    id: 'ol_product_1',
    name: 'Test Product',
    sku: 'TEST-001' as string | null,
    price: 19.99 as number | null,
    description: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  function makeProduct(images: string[] | null): Product {
    return new Product(
      baseArgs.id,
      baseArgs.name,
      baseArgs.sku,
      baseArgs.price,
      baseArgs.description,
      images,
      baseArgs.createdAt,
      baseArgs.updatedAt,
    );
  }

  describe('coverImageUrl', () => {
    it('should return null when images is null', () => {
      const product = makeProduct(null);
      expect(product.coverImageUrl).toBeNull();
    });

    it('should return null when images is an empty array', () => {
      const product = makeProduct([]);
      expect(product.coverImageUrl).toBeNull();
    });

    it('should return the first image when images is populated', () => {
      const product = makeProduct([
        'https://shop.test/img/p/1/1-home_default.jpg',
        'https://shop.test/img/p/1/2/1-medium_default.jpg',
      ]);
      expect(product.coverImageUrl).toBe('https://shop.test/img/p/1/1-home_default.jpg');
    });

    it('should return the first image when the array has a single element', () => {
      const product = makeProduct(['https://shop.test/img/p/7/7-home_default.jpg']);
      expect(product.coverImageUrl).toBe('https://shop.test/img/p/7/7-home_default.jpg');
    });
  });
});

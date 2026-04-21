/**
 * Product Cover Image Helper — Unit Spec
 *
 * Covers the cover-image rule: "first element of images, or null if empty/absent."
 * The Products bounded context's canonical "which image represents the product"
 * rule — mirrored here rather than replicated across consumers.
 *
 * @module libs/core/src/products/domain/utils
 */
import { coverImageUrl } from './product-cover-image';
import type { Product } from '../entities/product.entity';

function makeProduct(images: string[] | null): Product {
  return {
    id: 'ol_product_1',
    name: 'Test Product',
    sku: 'TEST-001',
    price: 19.99,
    description: null,
    images,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

describe('coverImageUrl', () => {
  it('should return null when images is null', () => {
    const product = makeProduct(null);
    expect(coverImageUrl(product)).toBeNull();
  });

  it('should return null when images is an empty array', () => {
    const product = makeProduct([]);
    expect(coverImageUrl(product)).toBeNull();
  });

  it('should return the first image when images is populated', () => {
    const product = makeProduct([
      'https://shop.test/img/p/1/1-home_default.jpg',
      'https://shop.test/img/p/1/2/1-medium_default.jpg',
    ]);
    expect(coverImageUrl(product)).toBe('https://shop.test/img/p/1/1-home_default.jpg');
  });

  it('should return the first image when the array has a single element', () => {
    const product = makeProduct(['https://shop.test/img/p/7/7-home_default.jpg']);
    expect(coverImageUrl(product)).toBe('https://shop.test/img/p/7/7-home_default.jpg');
  });
});

import { describe, expect, it } from 'vitest';
import { productImagePath, productImageProxyPath } from './product-image-path';

describe('productImagePath', () => {
  it('should return the proxy path for the first picture when the product has one', () => {
    expect(productImagePath({ id: 'ol_product_1', images: ['http://prestashop/1.jpg'] })).toBe(
      '/products/ol_product_1/images/0'
    );
  });

  it('should return null when the product has no pictures', () => {
    expect(productImagePath({ id: 'ol_product_1', images: [] })).toBeNull();
    expect(productImagePath({ id: 'ol_product_1', images: null })).toBeNull();
    expect(productImagePath({ id: 'ol_product_1' })).toBeNull();
  });

  it('should never return the stored shop url', () => {
    expect(productImagePath({ id: 'p', images: ['http://prestashop/1.jpg'] })).not.toContain(
      'prestashop'
    );
  });
});

describe('productImageProxyPath', () => {
  it('should encode the product id and carry the index', () => {
    expect(productImageProxyPath('a/b', 2)).toBe('/products/a%2Fb/images/2');
  });
});

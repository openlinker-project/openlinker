/**
 * Variant image path helpers (#3586)
 *
 * @module apps/api/src/products/http
 */
import {
  resolveVariantImageList,
  variantImageProxyPath,
  variantImageProxyPaths,
} from './product-image-path';

describe('variant image paths', () => {
  it('should build the variant route path and encode the id', () => {
    expect(variantImageProxyPath({ id: 'a/b' }, 2)).toBe('/products/variants/a%2Fb/images/2');
  });

  it('should prefer own images, then the product, never mixing them', () => {
    expect(resolveVariantImageList({ id: 'v', images: ['o'] }, ['p'])).toEqual({
      urls: ['o'],
      fromProduct: false,
    });
    expect(resolveVariantImageList({ id: 'v', images: [] }, ['p'])).toEqual({
      urls: ['p'],
      fromProduct: true,
    });
    expect(resolveVariantImageList({ id: 'v' }, null)).toEqual({ urls: [], fromProduct: false });
  });

  it('should emit one proxy path per resolved picture', () => {
    expect(variantImageProxyPaths({ id: 'v' }, ['a', 'b'])).toEqual({
      imageUrls: ['/products/variants/v/images/0', '/products/variants/v/images/1'],
      imagesFromProduct: true,
    });
  });
});

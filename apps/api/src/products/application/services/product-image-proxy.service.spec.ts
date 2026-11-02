/**
 * Product image proxy - variant resolution (#3586)
 *
 * Own images first, else the product's; the index addresses the RESOLVED list.
 * The SSRF host rule must still apply to a variant's urls.
 *
 * @module apps/api/src/products/application/services
 */
import type { IProductsService, Product, ProductVariant } from '@openlinker/core/products';
import { ProductImageProxyService } from './product-image-proxy.service';

const variant = (images: string[] | null): ProductVariant =>
  ({ id: 'v1', productId: 'p1', sku: 's', attributes: null, images }) as ProductVariant;
const product = (images: string[] | null): Product => ({ id: 'p1', images }) as Product;

describe('ProductImageProxyService.getVariantImage', () => {
  let products: jest.Mocked<Pick<IProductsService, 'getVariant' | 'getProduct'>>;
  let service: ProductImageProxyService;
  let fetchMock: jest.SpyInstance<Promise<Response>, [RequestInfo | URL, RequestInit?]>;

  beforeEach(() => {
    products = { getVariant: jest.fn(), getProduct: jest.fn() };
    service = new ProductImageProxyService(products as unknown as IProductsService);
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      })
    );
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it('should fetch the variant own image at the index', async () => {
    products.getVariant.mockResolvedValue(variant(['https://shop.test/own0.jpg', 'https://shop.test/own1.jpg']));

    const result = await service.getVariantImage('v1', 1);

    expect(result.kind).toBe('image');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://shop.test/own1.jpg');
    expect(products.getProduct).not.toHaveBeenCalled();
  });

  it("should fall back to the product's images when the variant has none", async () => {
    products.getVariant.mockResolvedValue(variant(null));
    products.getProduct.mockResolvedValue(product(['https://shop.test/p0.jpg']));

    const result = await service.getVariantImage('v1', 0);

    expect(result.kind).toBe('image');
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://shop.test/p0.jpg');
  });

  it('should answer not-found for an out-of-range index without fetching', async () => {
    products.getVariant.mockResolvedValue(variant(['https://shop.test/own0.jpg']));

    await expect(service.getVariantImage('v1', 3)).resolves.toEqual({
      kind: 'failure',
      reason: 'not-found',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('should answer not-found for an unknown variant', async () => {
    products.getVariant.mockResolvedValue(null);

    await expect(service.getVariantImage('nope', 0)).resolves.toEqual({
      kind: 'failure',
      reason: 'not-found',
    });
  });

  it('should still refuse a link-local host stored on a variant', async () => {
    products.getVariant.mockResolvedValue(variant(['http://169.254.169.254/latest/meta-data']));

    await expect(service.getVariantImage('v1', 0)).resolves.toEqual({
      kind: 'failure',
      reason: 'unusable-url',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

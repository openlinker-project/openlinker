/**
 * WooCommerce Product Publisher Adapter - visibility-only write (#3962)
 *
 * Taking a product off sale must reach WooCommerce as a PUT carrying `status`
 * and nothing else, so a product deleted at the master is hidden without its
 * stock, price or content being rewritten.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  isShopProductVisibilityWriter,
} from '@openlinker/core/listings';
import type { Connection } from '@openlinker/core/identifier-mapping';

import { WooCommerceHttpResponseException } from '../../../http/woocommerce-http-response.exception';
import type { IWooCommerceHttpClient } from '../../../http/woocommerce-http-client.interface';
import { WooCommerceProductPublisherAdapter } from '../woocommerce-product-publisher.adapter';

const connection = {
  id: 'conn-wc-1',
  platformType: 'woocommerce',
  name: 'Test WC',
  status: 'active',
  config: {},
  credentialsRef: 'cred-1',
  adapterKey: 'woocommerce.restapi.v3',
  enabledCapabilities: ['ProductPublisher'],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Connection;

describe('WooCommerceProductPublisherAdapter - setShopProductVisibility', () => {
  let http: jest.Mocked<IWooCommerceHttpClient>;
  let adapter: WooCommerceProductPublisherAdapter;

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
    http.put.mockResolvedValue({ id: 100, status: 'draft' });
    adapter = new WooCommerceProductPublisherAdapter(http, connection);
  });

  it('should be recognised as a ShopProductVisibilityWriter', () => {
    expect(isShopProductVisibilityWriter(adapter)).toBe(true);
  });

  it('should PUT exactly a draft status when hiding a product', async () => {
    await adapter.setShopProductVisibility({ externalProductId: '100', visible: false });

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', { status: 'draft' });
    expect(http.get).not.toHaveBeenCalled();
    expect(http.post).not.toHaveBeenCalled();
  });

  it('should PUT exactly a publish status when showing a product again', async () => {
    await adapter.setShopProductVisibility({ externalProductId: '100', visible: true });

    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', { status: 'publish' });
  });

  it('should report a product gone shop-side as a target-not-found error when WooCommerce answers 404', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(404, 'not found', 'woocommerce_rest_product_invalid_id'),
    );

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
  });

  it('should report a terminal rejection when WooCommerce answers 400', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(400, 'bad status', 'rest_invalid_param'),
    );

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
  });

  it('should propagate a transport failure untouched for the retry path', async () => {
    const failure = new WooCommerceHttpResponseException(503, 'unavailable');
    http.put.mockRejectedValue(failure);

    await expect(
      adapter.setShopProductVisibility({ externalProductId: '100', visible: false }),
    ).rejects.toBe(failure);
  });
});

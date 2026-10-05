/**
 * WooCommerce Product Publisher Adapter — price-only update (#3505, G01-10)
 *
 * A price change must reach WooCommerce as a PUT carrying the price and
 * nothing else: no stock, no `manage_stock`, no name, no description.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/adapters/product-publisher/__tests__
 */
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  isShopProductPriceUpdater,
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

describe('WooCommerceProductPublisherAdapter — updateShopProductPrice', () => {
  let http: jest.Mocked<IWooCommerceHttpClient>;
  let adapter: WooCommerceProductPublisherAdapter;

  beforeEach(() => {
    http = { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() };
    http.put.mockResolvedValue({ id: 100, status: 'publish' });
    adapter = new WooCommerceProductPublisherAdapter(http, connection);
  });

  it('should be recognised as a ShopProductPriceUpdater', () => {
    expect(isShopProductPriceUpdater(adapter)).toBe(true);
  });

  it('should PUT exactly the regular price to a standalone product', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '100',
      price: { amount: '399.00', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledTimes(1);
    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
      regular_price: '399.00',
    });
    expect(http.post).not.toHaveBeenCalled();
  });

  it('should PUT to the variation under its parent when a parent is given', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '201',
      externalParentProductId: '200',
      price: { amount: '49.90', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/200/variations/201', {
      regular_price: '49.90',
    });
  });

  it('should add the sale price only when the command carries one', async () => {
    await adapter.updateShopProductPrice({
      externalProductId: '100',
      price: { amount: '399.00', currency: 'PLN' },
      salePrice: { amount: '349.00', currency: 'PLN' },
    });

    expect(http.put).toHaveBeenCalledWith('/wp-json/wc/v3/products/100', {
      regular_price: '399.00',
      sale_price: '349.00',
    });
  });

  it('should report a product gone shop-side as a target-not-found error when WooCommerce answers 404', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(404, 'not found', 'woocommerce_rest_product_invalid_id'),
    );

    await expect(
      adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
  });

  it('should report a terminal rejection when WooCommerce answers 400', async () => {
    http.put.mockRejectedValue(
      new WooCommerceHttpResponseException(400, 'bad price', 'rest_invalid_param'),
    );

    await expect(
      adapter.updateShopProductPrice({
        externalProductId: '100',
        price: { amount: '399.00', currency: 'PLN' },
      }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
  });
});

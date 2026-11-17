/**
 * Shoper Product Publisher - visibility-only write (#3962)
 *
 * Taking a product off sale must reach Shoper as a partial PUT carrying only
 * the `active` flag in the shop default language, so its name, price, stock
 * and categories are never rewritten.
 *
 * @module libs/integrations/shoper/src/infrastructure/adapters/product-publisher/__tests__
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import {
  ProductPublishRejectedException,
  ProductPublishTargetNotFoundException,
  isShopProductVisibilityWriter,
} from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT } from '../../../__tests__/shoper-test-data';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

function setup(put: jest.Mock, language = 'pl_PL'): ShoperProductPublisherAdapter {
  return new ShoperProductPublisherAdapter(
    { get: jest.fn(), post: jest.fn(), put, delete: jest.fn() } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve({ ...MAP_CONTEXT, language }) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
}

describe('ShoperProductPublisherAdapter.setShopProductVisibility', () => {
  it('should satisfy the ShopProductVisibilityWriter guard', () => {
    expect(isShopProductVisibilityWriter(setup(jest.fn()))).toBe(true);
  });

  it('should PUT only the inactive flag in the shop language when hiding a product', async () => {
    const put = jest.fn().mockResolvedValue({ status: 200, data: true });

    await setup(put).setShopProductVisibility({ externalProductId: '207', visible: false });

    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/products/207', { translations: { pl_PL: { active: 0 } } });
  });

  it('should PUT only the active flag when showing a product again', async () => {
    const put = jest.fn().mockResolvedValue({ status: 200, data: true });

    await setup(put, 'en_GB').setShopProductVisibility({ externalProductId: '207', visible: true });

    expect(put).toHaveBeenCalledWith('/products/207', { translations: { en_GB: { active: 1 } } });
  });

  it('should refuse without writing when the shop reports no default language', async () => {
    const put = jest.fn();

    await expect(
      setup(put, '').setShopProductVisibility({ externalProductId: '207', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
    expect(put).not.toHaveBeenCalled();
  });

  it('should report a product Shoper says does not exist as a target-not-found error', async () => {
    const put = jest
      .fn()
      .mockRejectedValue(new ShoperApiError(404, 'invalid_request', 'Resource not found'));

    await expect(
      setup(put).setShopProductVisibility({ externalProductId: '207', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishTargetNotFoundException);
  });

  it('should report a terminal rejection when Shoper answers 400', async () => {
    const put = jest.fn().mockRejectedValue(new ShoperApiError(400, 'invalid_request', 'Bad value'));

    await expect(
      setup(put).setShopProductVisibility({ externalProductId: '207', visible: false }),
    ).rejects.toBeInstanceOf(ProductPublishRejectedException);
  });

  it('should let a transient failure propagate so the job retries', async () => {
    const error = new ShoperApiError(429, 'rate_limited');
    const put = jest.fn().mockRejectedValue(error);

    await expect(
      setup(put).setShopProductVisibility({ externalProductId: '207', visible: false }),
    ).rejects.toBe(error);
  });
});

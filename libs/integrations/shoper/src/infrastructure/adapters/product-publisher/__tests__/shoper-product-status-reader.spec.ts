import type { Connection } from '@openlinker/core/identifier-mapping';
import { isShopProductStatusReader } from '@openlinker/core/listings';

import { ShoperApiError } from '../../../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../../../domain/exceptions/shoper-network.error';
import type { ShoperProductTranslation } from '../../../../domain/types/shoper-api.types';
import type { ShoperHttpClient } from '../../../http/shoper-http-client';
import type { ShoperShopContextProvider } from '../../../shop-context/shoper-shop-context.provider';
import { MAP_CONTEXT, buildProduct } from '../../../__tests__/shoper-test-data';
import { ShoperProductPublisherAdapter } from '../shoper-product-publisher.adapter';

function setup(get: jest.Mock, language = MAP_CONTEXT.language): ShoperProductPublisherAdapter {
  return new ShoperProductPublisherAdapter(
    { get, post: jest.fn(), put: jest.fn(), delete: jest.fn() } as unknown as ShoperHttpClient,
    { get: () => Promise.resolve({ ...MAP_CONTEXT, language }) } as unknown as ShoperShopContextProvider,
    { id: 'conn-1', adapterKey: 'shoper.restapi.v1' } as unknown as Connection,
  );
}

/** `GET /products/:id` answering a product whose `pl_PL` translation carries `active`. */
function answering(active: ShoperProductTranslation['active'], language = 'pl_PL'): jest.Mock {
  return jest.fn().mockResolvedValue({
    status: 200,
    data: buildProduct({ translations: { [language]: { name: 'Kubek', active } } }),
  });
}

describe('ShoperProductPublisherAdapter.getShopProductStatus', () => {
  it('should satisfy the ShopProductStatusReader guard', () => {
    expect(isShopProductStatusReader(setup(jest.fn()))).toBe(true);
  });

  it('should read the product by its Shoper id', async () => {
    const get = answering('1');

    await setup(get).getShopProductStatus('207');

    expect(get).toHaveBeenCalledWith('/products/207');
  });

  it.each([['1'], [1], [true]])('should read an active product (%p) as published', async (active) => {
    await expect(setup(answering(active)).getShopProductStatus('207')).resolves.toEqual({
      publicationStatus: 'published',
    });
  });

  it.each([['0'], [0], [false]])(
    'should read an inactive product (%p) as draft, the status the publisher writes as inactive',
    async (active) => {
      await expect(setup(answering(active)).getShopProductStatus('207')).resolves.toEqual({
        publicationStatus: 'draft',
      });
    },
  );

  it('should read the visibility in the shop default language, not another one', async () => {
    const get = jest.fn().mockResolvedValue({
      status: 200,
      data: buildProduct({
        translations: {
          en_GB: { name: 'Mug', active: '1' },
          pl_PL: { name: 'Kubek', active: '0' },
        },
      }),
    });

    await expect(setup(get).getShopProductStatus('207')).resolves.toEqual({
      publicationStatus: 'draft',
    });
  });

  it('should report a product Shoper says does not exist as removed', async () => {
    const get = jest
      .fn()
      .mockRejectedValue(new ShoperApiError(404, 'invalid_request', 'Resource not found'));

    await expect(setup(get).getShopProductStatus('207')).resolves.toEqual({
      publicationStatus: 'removed',
    });
  });

  it('should not read a bare 404 (no Shoper envelope) as a removal, so a misconfigured host cannot stale listings', async () => {
    const error = new ShoperApiError(404);
    const get = jest.fn().mockRejectedValue(error);

    await expect(setup(get).getShopProductStatus('207')).rejects.toBe(error);
  });

  it('should let a transient failure propagate so the job retries', async () => {
    const error = new ShoperApiError(429, 'rate_limited');
    const get = jest.fn().mockRejectedValue(error);

    await expect(setup(get).getShopProductStatus('207')).rejects.toBe(error);
  });

  it.each([
    ['no flag', answering(undefined)],
    ['an unknown flag value', answering('yes')],
    ['no translation in the shop language', answering('1', 'en_GB')],
    ['an empty body', jest.fn().mockResolvedValue({ status: 200, data: null })],
  ])('should refuse to guess a status from %s', async (_label, get) => {
    await expect(setup(get).getShopProductStatus('207')).rejects.toBeInstanceOf(ShoperNetworkError);
  });

  it('should refuse to guess when the shop reports no default language', async () => {
    await expect(setup(answering('1'), '').getShopProductStatus('207')).rejects.toBeInstanceOf(
      ShoperNetworkError,
    );
  });
});
